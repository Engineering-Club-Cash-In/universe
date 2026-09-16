/**
 * COBROS-02 — avisarle al asesor que su cliente pasó a MODO AGENTE en el bot.
 *
 * El primer aviso (`aviso-bot-asesor.ts`, `bot_cliente_escribio`) dice "tu
 * cliente está usando el bot". Este es el segundo momento de esa misma
 * conversación, el que sí pide acción inmediata: el cliente pidió hablar con
 * una persona y está esperando en WhatsApp. El asesor entra a Witty Agent y le
 * contesta, o lo llama.
 *
 * ── Quién lo dispara ────────────────────────────────────────────────────────
 * SimpleTech, con `POST /api/bot/cobros/conversacion/modo-agente` (referencia +
 * numeroSifco). El modo agente vive en su motor; nosotros no lo vemos pasar.
 *
 * ── Hilo con el aviso inicial ───────────────────────────────────────────────
 * Las dos alertas comparten la llave de conversación (`llaveDedupSesionBot`) y
 * esta apunta a la inicial por `notificacion_origen_id`. Si no hubo inicial
 * —el cliente fue directo, o el asesor no estaba vinculado cuando escribió—
 * se crea igual, sin origen: el cliente sigue esperando.
 *
 * ── Una por conversación y crédito ──────────────────────────────────────────
 * Si el cliente vuelve a pedir agente en la misma conversación no se repite:
 * el asesor ya tiene la alerta abierta. El índice único de la 0054 lo sostiene
 * bajo concurrencia; el SELECT previo solo evita el viaje a cartera.
 *
 * A diferencia del aviso inicial, esto NO es best-effort silencioso: el bot
 * llama a un endpoint dedicado para esto, así que el resultado se devuelve y
 * un fallo de cartera se reporta (el bot puede reintentar).
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "../db/schema/notifications";
import {
	type DestinoAvisoBot,
	llaveDedupSesionBot,
	resolverDestinoAvisoBot,
} from "./aviso-bot-asesor";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[BotModoAgente]";

export type ResultadoAvisoModoAgente =
	/** Se creó la alerta (o la ganó una petición simultánea: igual quedó). */
	| { ok: true; motivo: "NOTIFICADO"; conOrigen: boolean }
	/** Esta conversación ya había avisado el modo agente por este crédito. */
	| { ok: true; motivo: "YA_NOTIFICADO" }
	/** El crédito no tiene asesor, o su asesor no tiene usuario en el CRM. */
	| { ok: true; motivo: "SIN_ASESOR" }
	/** Cartera no respondió: no se sabe quién es el dueño. */
	| { ok: false; motivo: "CARTERA_NO_DISPONIBLE" };

type FilaNueva = typeof notifications.$inferInsert;

/** Lo que toca afuera. Inyectable para probar la decisión sin base ni HTTP. */
export type DependenciasModoAgente = {
	/** id de la alerta de ese tipo con esa llave, si existe. */
	buscarAviso: (
		tipo: "bot_cliente_escribio" | "bot_modo_agente",
		llave: string,
	) => Promise<string | null>;
	carteraHabilitada: () => boolean;
	resolverDestino: (numeroSifco: string) => Promise<DestinoAvisoBot | null>;
	insertar: (fila: FilaNueva) => Promise<void>;
};

const dependenciasReales: DependenciasModoAgente = {
	buscarAviso: async (tipo, llave) => {
		const [fila] = await db
			.select({ id: notifications.id })
			.from(notifications)
			.where(
				and(
					eq(notifications.cobrosTipo, tipo),
					eq(notifications.cobrosDedupKey, llave),
				),
			)
			.limit(1);
		return fila?.id ?? null;
	},
	carteraHabilitada: isCarteraBackEnabled,
	resolverDestino: resolverDestinoAvisoBot,
	insertar: async (fila) => {
		await db.insert(notifications).values(fila).onConflictDoNothing();
	},
};

/**
 * Crea la alerta de modo agente. Supone que el caller YA verificó que la
 * referencia es de un cliente identificado y que el crédito es suyo: con un
 * SIFCO sin verificar, esto le avisaría a un asesor ajeno.
 */
export async function avisarAsesorModoAgente(
	params: { sesionId: string; numeroSifco: string },
	deps: DependenciasModoAgente = dependenciasReales,
): Promise<ResultadoAvisoModoAgente> {
	const llave = llaveDedupSesionBot(params.sesionId, params.numeroSifco);

	if (await deps.buscarAviso("bot_modo_agente", llave)) {
		return { ok: true, motivo: "YA_NOTIFICADO" };
	}

	// Sin cartera no hay forma de saber quién es el dueño hoy.
	if (!deps.carteraHabilitada()) {
		return { ok: false, motivo: "CARTERA_NO_DISPONIBLE" };
	}

	let destino: DestinoAvisoBot | null;
	try {
		destino = await deps.resolverDestino(params.numeroSifco);
	} catch (err) {
		console.error(
			`${LOG_PREFIX} cartera no respondió para ${params.numeroSifco}:`,
			err instanceof Error ? err.message : err,
		);
		return { ok: false, motivo: "CARTERA_NO_DISPONIBLE" };
	}
	if (!destino) {
		console.warn(
			`${LOG_PREFIX} crédito ${params.numeroSifco} sin asesor vinculado en el CRM: nadie recibe el aviso de modo agente.`,
		);
		return { ok: true, motivo: "SIN_ASESOR" };
	}

	// Se busca DESPUÉS de resolver el destino a propósito: el aviso inicial lo
	// escribe el historial en background, así que cuanto más tarde se mire,
	// más probable es que ya esté.
	const origenId = await deps.buscarAviso("bot_cliente_escribio", llave);

	const { usuarioAsesor, quien, anclaCaso } = destino;
	await deps.insertar({
		titulo: "Tu cliente pidió hablar con un asesor",
		descripcion: `${quien} pasó a modo agente en el bot de WhatsApp y está esperando respuesta. Contestale desde Witty Agent o llamalo.`,
		type: "reminder",
		status: "pending",
		cobrosTipo: "bot_modo_agente",
		cobrosDedupKey: llave,
		notificacionOrigenId: origenId,
		...anclaCaso,
		// Mismo criterio que el aviso inicial: lo dispara el cliente, que no
		// es usuario del CRM, así que creador y destinatario son el asesor.
		createdBy: usuarioAsesor.id,
		createdByRole: "cobros",
		assignedToRole: "cobros",
		assignedTo: usuarioAsesor.id,
	});

	return { ok: true, motivo: "NOTIFICADO", conOrigen: origenId !== null };
}
