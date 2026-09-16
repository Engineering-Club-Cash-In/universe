/**
 * COBROS-02 · Fase 1.b — avisarle al asesor que un cliente suyo escribió en el
 * bot de WhatsApp.
 *
 * Sale del criterio 1 del ticket ("si escriben por WhatsApp… el asesor asignado
 * debe responder") y no existía nada: el bot atiende al cliente, deja su
 * historial en la Ficha 360 y no avisa a nadie — no hay una sola
 * `createNotification` en todo el módulo del bot. Hoy el asesor se entera solo
 * si abre la ficha.
 *
 * ── Cuándo se dispara ───────────────────────────────────────────────────────
 * En la PRIMERA interacción de la conversación que ya trae `numero_sifco`. Las
 * primeras acciones (`buscar_cliente`, `listar_creditos`) no lo traen: recién
 * cuando el cliente entra a un crédito se sabe de qué crédito —y por lo tanto
 * de qué asesor— se trata. Los `acceso_fallido` quedan fuera solos: no tienen
 * sesión (D-43) ni identidad resuelta.
 *
 * ── Una alerta por CONVERSACIÓN ─────────────────────────────────────────────
 * La "conversación" del bot es la `referencia` del paso 1 —la fila de `otps`—,
 * que en `bot_cobros_interacciones` vive como `sesion_id`: la misma llave por
 * la que la Ficha 360 agrupa y numera ("Referencia 1" = la más vieja), sin FK a
 * propósito para sobrevivir a la purga del OTP (decisión 17 del plan 08).
 * Se reusa `cobros_dedup_key` con `bot:sesion:<uuid>` y el índice único parcial
 * `uq_notifications_cobros_dedup` (migración 0054): un cliente que navega diez
 * pantallas genera UN aviso, no diez.
 *
 * ── A quién ─────────────────────────────────────────────────────────────────
 * Al asesor dueño del crédito, esté en el bucket que esté (decisión 16). Solo a
 * él: no es una falta que escalar, es una conversación que atender.
 *
 * Todo es best-effort y nunca lanza: corre colgado del middleware del historial,
 * que a su vez corre después de responderle al bot. Un fallo acá no puede
 * costar una conversación.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[BotAvisoAsesor]";

/** La llave del episodio: una conversación del bot = una alerta. */
export function llaveDedupSesionBot(sesionId: string): string {
	return `bot:sesion:${sesionId}`;
}

export interface AvisoBotParams {
	/** `sesion_id` de `bot_cobros_interacciones` (la referencia del paso 1). */
	sesionId: string | null;
	/** Solo viene en acciones sobre un crédito; sin él no hay asesor que resolver. */
	numeroSifco: string | null;
	/** La acción del historial (`menu_credito`, `estado_cuenta`, `boleta_leer`…). */
	accion: string;
}

/**
 * Texto humano por acción. No es una allowlist de seguridad (acá no se escribe
 * nada del cliente), solo la diferencia entre "escribió" y "qué vino a hacer":
 * lo que le dice al asesor si esto puede esperar o no.
 */
const QUE_HIZO: Record<string, string> = {
	menu_credito: "consultó su crédito",
	estado_cuenta: "pidió su estado de cuenta",
	boleta_leer: "subió una boleta de pago",
	boleta_confirmar: "confirmó una boleta de pago",
	pago_link_opciones: "consultó opciones de pago",
	pago_link_crear: "generó un link de pago",
	pago_link_estado: "revisó el estado de su link de pago",
};

export async function avisarAsesorPorInteraccionBot(
	params: AvisoBotParams,
): Promise<void> {
	try {
		const { sesionId, numeroSifco } = params;
		// Sin conversación no hay llave de dedup; sin SIFCO no hay asesor.
		if (!sesionId || !numeroSifco) return;

		// Corte barato PRIMERO: si esta conversación ya avisó, se sale sin tocar
		// cartera. Es el caso común —una conversación son varias peticiones— y
		// evita un HTTP por cada pantalla que el cliente abre. No sustituye al
		// índice único (dos peticiones simultáneas lo pasan las dos): ese es el
		// que garantiza la unicidad, esto solo evita el trabajo.
		const llave = llaveDedupSesionBot(sesionId);
		const [yaAvisado] = await db
			.select({ id: notifications.id })
			.from(notifications)
			.where(
				and(
					eq(notifications.cobrosTipo, "bot_cliente_escribio"),
					eq(notifications.cobrosDedupKey, llave),
				),
			)
			.limit(1);
		if (yaAvisado) return;

		if (!isCarteraBackEnabled()) return;

		// El caso de cobros es a dónde navega la notificación y el ancla de
		// `related_entity_id`. Sin caso no hay a dónde mandar al asesor.
		const [caso] = await db
			.select({ id: casosCobros.id })
			.from(casosCobros)
			.where(
				and(
					eq(casosCobros.numeroCreditoSifco, numeroSifco),
					eq(casosCobros.activo, true),
				),
			)
			.limit(1);
		if (!caso) return;

		// Dueño REAL del crédito, sin cache: entre el bucket de ayer y hoy el
		// motor pudo reasignarlo, y el aviso tiene que llegarle a quien lo lleva
		// ahora. `useCircuitBreaker=false` porque esto es best-effort y no debe
		// compartir contador de fallos con las operaciones que sí importan.
		const respuesta = await carteraBackClient.getCredito(
			numeroSifco,
			false,
			false,
		);
		const emailAsesor = respuesta?.asesor?.emailCashIn?.trim().toLowerCase();
		if (!emailAsesor) return;

		// El puente de identidad de siempre: `asesores.email_cash_in` == `user.email`.
		const [usuarioAsesor] = await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(eq(user.email, emailAsesor))
			.limit(1);
		if (!usuarioAsesor) return;

		const cliente = respuesta?.usuario?.nombre?.trim();
		const quien = cliente
			? `${cliente} (crédito ${numeroSifco})`
			: `El crédito ${numeroSifco}`;
		const queHizo = QUE_HIZO[params.accion] ?? "escribió al bot de cobros";

		await db
			.insert(notifications)
			.values({
				titulo: "Tu cliente escribió por WhatsApp",
				descripcion: `${quien} ${queHizo} en el bot. Dale seguimiento: si escribió es porque algo necesita.`,
				type: "reminder",
				status: "pending",
				cobrosTipo: "bot_cliente_escribio",
				cobrosDedupKey: llave,
				relatedEntityType: "collection_case",
				relatedEntityId: caso.id,
				redirectPage: "cobros_detail",
				// La UI muestra el nombre de `createdBy` junto a `createdByRole`:
				// acá los dos describen al mismo asesor, que es también el
				// destinatario. No hay un humano distinto detrás — lo dispara el
				// cliente, que no es usuario del CRM.
				createdBy: usuarioAsesor.id,
				createdByRole: "cobros",
				assignedToRole: "cobros",
				assignedTo: usuarioAsesor.id,
			})
			// La dedup real: dos peticiones del bot a la vez pasan el SELECT de
			// arriba, pero solo una gana el índice único parcial.
			.onConflictDoNothing();
	} catch (err) {
		console.warn(
			`${LOG_PREFIX} No se pudo avisar al asesor (best-effort):`,
			err instanceof Error ? err.message : err,
		);
	}
}
