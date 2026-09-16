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

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[BotAvisoAsesor]";

/**
 * La llave del episodio: una conversación del bot **por crédito** = una alerta.
 *
 * El crédito entra en la llave y no es un detalle (review de Codex, P2). El
 * índice único es `(cobros_tipo, cobros_dedup_key, assigned_to)` —lleva el
 * destinatario porque otras alertas de cobros van al asesor Y a cada
 * supervisor—, así que una llave de solo `sesionId` NO garantizaba nada cuando
 * dos peticiones simultáneas de la misma conversación tocaban créditos de
 * asesores distintos: las dos insertaban.
 *
 * Con el crédito adentro, la unicidad que la base sostiene es exactamente la
 * que el código promete, porque un crédito tiene un solo dueño a la vez. Y la
 * semántica que queda es la que conviene:
 *
 *   · diez pantallas sobre el mismo crédito → UN aviso (el caso real de spam);
 *   · dos créditos de dos asesores en una conversación → un aviso cada uno,
 *     que es justo lo que cada dueño necesita saber.
 */
export function llaveDedupSesionBot(
	sesionId: string,
	numeroSifco: string,
): string {
	return `bot:sesion:${sesionId}:credito:${numeroSifco}`;
}

export interface AvisoBotParams {
	/** `sesion_id` de `bot_cobros_interacciones` (la referencia del paso 1). */
	sesionId: string | null;
	/** Solo viene en acciones sobre un crédito; sin él no hay asesor que resolver. */
	numeroSifco: string | null;
	/** La acción del historial (`menu_credito`, `estado_cuenta`, `boleta_leer`…). */
	accion: string;
	/** ¿La petición del bot salió bien? */
	exito: boolean;
	/** `codigo` del fallo (OTP_INVALIDO, CARTERA_NO_DISPONIBLE…). Null si salió bien. */
	codigo?: string | null;
}

/**
 * Códigos de fallo que solo pueden producirse DESPUÉS de que el bot verificó
 * que el crédito es del cliente.
 *
 * ── Por qué una lista blanca y no una negra ─────────────────────────────────
 * El primer intento fue enumerar los fallos de acceso y avisar en todo lo
 * demás. Se rompió por algo que no se ve leyendo este archivo: los
 * controladores **traducen** el código interno antes de que el historial lo
 * lea. `CREDITO_NO_ES_DEL_CLIENTE` sale al mundo como `CREDITO_NO_ENCONTRADO`
 * —a propósito, para que nadie averigüe qué créditos existen probando
 * números— y ese código público no estaba en la lista negra, así que el caso
 * que la lista existía para bloquear pasaba igual (review de Codex).
 *
 * La moraleja no es "agregar CREDITO_NO_ENCONTRADO": es que **no se puede
 * enumerar con confianza todas las formas en que la propiedad puede fallar**,
 * porque el vocabulario lo define otra capa y puede crecer. Lo que sí se puede
 * enumerar es lo contrario: estos fallos concretos ocurren sobre un crédito ya
 * resuelto y verificado.
 *
 * Con esta forma, lo desconocido **calla**. Un código nuevo posterior al
 * control no avisa hasta que alguien lo agregue acá — cuesta un seguimiento
 * perdido. Con la lista negra, un código nuevo de acceso **avisaba al asesor
 * de un crédito ajeno** y quemaba la llave de dedup. La asimetría manda.
 */
const CODIGOS_POSTERIORES_AL_CONTROL = new Set([
	// El crédito es suyo, pero cartera no respondió o no tiene qué mostrar.
	"CARTERA_NO_DISPONIBLE",
	"CREDITO_SIN_DATOS",
	"CREDITO_REQUIERE_REVISION",
	"SIN_ESTADO_DE_CUENTA",
	"MORA_POR_CONFIRMAR",
	// El crédito es suyo, pero no admite esta vía de pago.
	"CREDITO_NO_ACEPTA_BOLETA",
	"CREDITO_NO_PAGABLE_POR_LINK",
	"SIN_CUOTAS_QUE_PAGAR",
	"SIN_LINKS",
	"PAGALO_NO_DISPONIBLE",
	// Solo vale como prueba porque `crearPagoLink` verifica la propiedad ANTES
	// de mirar el monto. Con el orden inverso este código salía sin haber
	// pasado por el control, y un monto basura contra el SIFCO de otro cliente
	// le avisaba a un asesor ajeno (review de Codex, P2). Se auditaron los
	// demás códigos de esta lista: todos salen después de `armarContexto`, o
	// de una fila acotada a (otpId, numeroSifco), que es la misma prueba.
	"MONTO_DESACTUALIZADO",
	// El crédito es suyo y ya hay plata en camino.
	"PAGO_EN_PROCESO",
	"PAGO_PARCIAL_EN_CURSO",
	"PAGO_NO_REGISTRADO",
	"BOLETA_DUPLICADA",
	"BOLETA_YA_CONFIRMADA",
	"CONFIRMACION_EN_CURSO",
]);

export function pruebaPropiedadDelCredito(params: {
	exito: boolean;
	codigo?: string | null;
}): boolean {
	if (params.exito) return true;
	// Todo lo que no esté explícitamente reconocido como posterior al control
	// se trata como si la propiedad nunca se hubiera verificado.
	if (!params.codigo) return false;
	return CODIGOS_POSTERIORES_AL_CONTROL.has(params.codigo);
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
		// Solo si esta interacción probó que el crédito es del cliente: salió
		// bien, o falló DESPUÉS del control de acceso (ver la lista de códigos).
		if (!pruebaPropiedadDelCredito(params)) return;

		// Corte barato PRIMERO: si esta conversación ya avisó por este crédito,
		// se sale sin tocar cartera. Es el caso común —una conversación son
		// varias peticiones— y evita un HTTP por cada pantalla que el cliente
		// abre. No sustituye al índice único (dos peticiones simultáneas lo
		// pasan las dos): ese es el que garantiza la unicidad, esto solo evita
		// el trabajo.
		const llave = llaveDedupSesionBot(sesionId, numeroSifco);
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

		// El caso de cobros es a dónde navega la notificación. Se toma el ACTIVO
		// si lo hay y si no el más reciente — un caso cerrado sigue siendo la
		// ficha correcta de ese crédito.
		//
		// Y si no hay ninguno, el aviso se manda IGUAL, sin enlace (review de
		// Codex, P1): `sync-casos-cobros` solo mantiene caso activo cuando
		// `diasMora > 0`, así que exigirlo dejaba justo a los buckets sanos sin
		// aviso — los mismos que la decisión 16 nombra explícitamente ("al
		// asesor dueño del crédito, esté donde esté"). Un cliente al día que
		// escribe es de los que MÁS vale la pena atender rápido.
		const [caso] = await db
			.select({ id: casosCobros.id })
			.from(casosCobros)
			.where(eq(casosCobros.numeroCreditoSifco, numeroSifco))
			.orderBy(desc(casosCobros.activo), desc(casosCobros.createdAt))
			.limit(1);

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
		//
		// Los DOS lados normalizados (review de Codex, P2): el alta de usuarios
		// del CRM no normaliza el correo que guarda, así que una cuenta creada
		// con mayúsculas o un espacio de más no matcheaba y la función se
		// devolvía en silencio, sin avisarle a nadie. Mismo criterio que el
		// resto de los puentes de cobros (`convenio-decision.ts` compara contra
		// `lower(btrim(user.email))`).
		const [usuarioAsesor] = await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(sql`lower(trim(${user.email})) = ${emailAsesor}`)
			.limit(1);
		if (!usuarioAsesor) return;

		const cliente = respuesta?.usuario?.nombre?.trim();
		const quien = cliente
			? `${cliente} (crédito ${numeroSifco})`
			: `El crédito ${numeroSifco}`;
		const queHizo = QUE_HIZO[params.accion] ?? "escribió al bot de cobros";
		// Cuando el bot le falló, decirlo: es la diferencia entre "escribió" y
		// "escribió y se quedó sin respuesta", que cambia la urgencia.
		const cierre = params.exito
			? "Dale seguimiento: si escribió es porque algo necesita."
			: "El bot no pudo completarlo, así que sigue esperando. Llamalo.";
		// Sin caso no hay a dónde navegar: el aviso se manda igual pero sin
		// enlace, y el texto carga el SIFCO para que se pueda buscar a mano.
		const anclaCaso = caso
			? {
					relatedEntityType: "collection_case" as const,
					relatedEntityId: caso.id,
					redirectPage: "cobros_detail" as const,
				}
			: {};

		await db
			.insert(notifications)
			.values({
				titulo: "Tu cliente escribió por WhatsApp",
				descripcion: `${quien} ${queHizo} en el bot. ${cierre}`,
				type: "reminder",
				status: "pending",
				cobrosTipo: "bot_cliente_escribio",
				cobrosDedupKey: llave,
				...anclaCaso,
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
