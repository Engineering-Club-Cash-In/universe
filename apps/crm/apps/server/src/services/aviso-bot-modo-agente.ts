/**
 * COBROS-02 — avisarle al asesor que su cliente pasó a MODO AGENTE en el bot.
 *
 * El primer aviso (`aviso-bot-asesor.ts`, `bot_cliente_escribio`) dice "tu
 * cliente está usando el bot". Este es el momento que sí pide acción
 * inmediata: el cliente pidió hablar con una persona y está esperando en
 * WhatsApp. El asesor entra a Witty Agent y le contesta, o lo llama.
 *
 * ── Quién lo dispara ────────────────────────────────────────────────────────
 * SimpleTech, con `POST /api/bot/cobros/conversacion/modo-agente`. El modo
 * agente vive en su motor; nosotros no lo vemos pasar.
 *
 * ── Cómo se sabe quién es ───────────────────────────────────────────────────
 * Con la `referencia` si el cliente se identificó en el bot, o con el
 * TELÉFONO desde el que escribe si no (el que dice "hola" y pide un humano sin
 * pasar por el OTP). El controlador resuelve eso y le pasa a este servicio los
 * créditos: uno si el bot mandó `numeroSifco`, todos los de la persona si no.
 *
 * ── Una alerta por asesor ───────────────────────────────────────────────────
 * Cada crédito se resuelve a su dueño de HOY y se agrupa: un asesor con tres
 * créditos de ese cliente recibe UNA alerta que los nombra, no tres.
 *
 * "Ya avisado" es POR ASESOR (review de Codex, P1): en la ventana de la
 * conversación el motor puede reasignar el crédito, y la alerta del dueño
 * anterior no puede tapar la del actual. Por eso primero se resuelve el dueño
 * y la dedup va acotada a él — el mismo `assigned_to` del índice único.
 *
 * La llave de la conversación (la BASE):
 *   · con referencia → `bot:sesion:<referencia>:agente`
 *   · con teléfono   → `bot:tel:<8 dígitos>:dia:<fecha GT>:agente`
 *     (sin referencia no hay conversación que nombrar; el día evita que un
 *     cliente que vuelve mañana quede callado por la alerta de hoy).
 *
 * ── Episodios: la dedup solo calla mientras la alerta siga ABIERTA ─────────
 * Review de Codex (P1, PR #1628): sin referencia, dos conversaciones del mismo
 * día comparten la base. Si la primera alerta ya se resolvió o descartó y el
 * cliente vuelve a pedir un humano, una dedup por llave fija respondía
 * `YA_NOTIFICADO` y ese cliente no le llegaba a nadie. Por eso cada alerta
 * lleva `<base>:ep:<n>`:
 *   · hay una abierta (pending/read/in_progress) → `YA_NOTIFICADO`;
 *   · no hay, o todas se cerraron → episodio `n+1`.
 * Dos peticiones simultáneas calculan el mismo `n`, así que el índice único
 * sigue garantizando una sola fila por episodio.
 *
 * ── Hilo con el aviso inicial ───────────────────────────────────────────────
 * Con referencia, la alerta apunta por `notificacion_origen_id` al
 * `bot_cliente_escribio` del mismo asesor en esa conversación. Con teléfono no
 * hubo aviso inicial (ese nace de navegar un crédito ya identificado).
 *
 * A diferencia del aviso inicial, esto NO es best-effort silencioso: el bot
 * llama a un endpoint dedicado, así que un fallo de cartera se reporta y el bot
 * puede reintentar (la dedup evita duplicar lo que ya salió).
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "../db/schema/notifications";
import { toDateStrGT } from "../lib/guatemala-month-window";
import {
	type DestinoAvisoBot,
	llaveDedupSesionBot,
	resolverDestinoAvisoBot,
} from "./aviso-bot-asesor";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[BotModoAgente]";

/** Cómo se identificó a quien pidió el agente. */
export type OrigenModoAgente =
	| { tipo: "referencia"; sesionId: string }
	| { tipo: "telefono"; telefono8: string };

export type ResultadoAvisoModoAgente =
	/** Al menos un asesor recibió una alerta nueva. */
	| { ok: true; motivo: "NOTIFICADO"; asesores: number }
	/** Todos los asesores ya tienen una alerta ABIERTA de esta conversación. */
	| { ok: true; motivo: "YA_NOTIFICADO"; asesores: number }
	/** Ningún crédito tiene un asesor con usuario en el CRM. */
	| { ok: true; motivo: "SIN_ASESOR"; asesores: 0 }
	/** Cartera no respondió: no se sabe quién es el dueño. */
	| { ok: false; motivo: "CARTERA_NO_DISPONIBLE" };

type FilaNueva = typeof notifications.$inferInsert;

/** Estados en los que la alerta todavía le pide algo al asesor. */
const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

/** Lo que toca afuera. Inyectable para probar la decisión sin base ni HTTP. */
export type DependenciasModoAgente = {
	/**
	 * Episodios de modo agente con esa base PARA ese asesor: cuántos hubo y si
	 * alguno sigue abierto.
	 */
	episodios: (
		base: string,
		asesorUserId: string,
	) => Promise<{ total: number; abierto: boolean }>;
	/** id de la alerta de ese tipo, con esa llave, PARA ese asesor, si existe. */
	buscarAviso: (
		tipo: "bot_cliente_escribio" | "bot_modo_agente",
		llave: string,
		asesorUserId: string,
	) => Promise<string | null>;
	carteraHabilitada: () => boolean;
	resolverDestino: (numeroSifco: string) => Promise<DestinoAvisoBot | null>;
	insertar: (fila: FilaNueva) => Promise<void>;
	hoyGT: () => string;
};

/** Episodios de modo agente con esa base para ese asesor (ver encabezado). */
export async function episodiosModoAgente(
	base: string,
	asesorUserId: string,
): Promise<{ total: number; abierto: boolean }> {
	// La base sola cuenta como episodio: es la forma de las alertas creadas
	// antes de que existieran los episodios (#1627).
	const [fila] = await db
		.select({
			total: sql<number>`count(*)::int`,
			abierto: sql<boolean>`coalesce(bool_or(${inArray(notifications.status, [...ESTADOS_ABIERTOS])}), false)`,
		})
		.from(notifications)
		.where(
			and(
				eq(notifications.cobrosTipo, "bot_modo_agente"),
				eq(notifications.assignedTo, asesorUserId),
				or(
					eq(notifications.cobrosDedupKey, base),
					sql`left(${notifications.cobrosDedupKey}, length(${`${base}:ep:`}::text)) = ${`${base}:ep:`}::text`,
				),
			),
		);
	return { total: fila?.total ?? 0, abierto: fila?.abierto ?? false };
}

const dependenciasReales: DependenciasModoAgente = {
	episodios: episodiosModoAgente,
	buscarAviso: async (tipo, llave, asesorUserId) => {
		const [fila] = await db
			.select({ id: notifications.id })
			.from(notifications)
			.where(
				and(
					eq(notifications.cobrosTipo, tipo),
					eq(notifications.cobrosDedupKey, llave),
					eq(notifications.assignedTo, asesorUserId),
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
	hoyGT: () => toDateStrGT(new Date()),
};

export function llaveModoAgente(
	origen: OrigenModoAgente,
	hoyGT: string,
): string {
	return origen.tipo === "referencia"
		? `bot:sesion:${origen.sesionId}:agente`
		: `bot:tel:${origen.telefono8}:dia:${hoyGT}:agente`;
}

/**
 * Crea las alertas de modo agente. Supone que el caller YA resolvió que esos
 * créditos son de quien escribe (por referencia verificada o por su teléfono):
 * con un SIFCO cualquiera, esto le avisaría a un asesor ajeno.
 */
export async function avisarAsesorModoAgente(
	params: { origen: OrigenModoAgente; creditos: string[] },
	deps: DependenciasModoAgente = dependenciasReales,
): Promise<ResultadoAvisoModoAgente> {
	// Sin cartera no hay forma de saber quién es el dueño hoy.
	if (!deps.carteraHabilitada()) {
		return { ok: false, motivo: "CARTERA_NO_DISPONIBLE" };
	}

	// Dueño de HOY de cada crédito, agrupado por asesor (en el orden recibido).
	const porAsesor = new Map<
		string,
		{ destino: DestinoAvisoBot; creditos: string[] }
	>();
	for (const numeroSifco of params.creditos) {
		let destino: DestinoAvisoBot | null;
		try {
			destino = await deps.resolverDestino(numeroSifco);
		} catch (err) {
			console.error(
				`${LOG_PREFIX} cartera no respondió para ${numeroSifco}:`,
				err instanceof Error ? err.message : err,
			);
			return { ok: false, motivo: "CARTERA_NO_DISPONIBLE" };
		}
		if (!destino) {
			console.warn(
				`${LOG_PREFIX} crédito ${numeroSifco} sin asesor vinculado en el CRM: nadie recibe su aviso de modo agente.`,
			);
			continue;
		}
		const grupo = porAsesor.get(destino.usuarioAsesor.id);
		if (grupo) grupo.creditos.push(numeroSifco);
		else
			porAsesor.set(destino.usuarioAsesor.id, {
				destino,
				creditos: [numeroSifco],
			});
	}

	if (porAsesor.size === 0) {
		return { ok: true, motivo: "SIN_ASESOR", asesores: 0 };
	}

	const base = llaveModoAgente(params.origen, deps.hoyGT());
	let nuevos = 0;

	for (const [asesorUserId, { destino, creditos }] of porAsesor) {
		const { total, abierto } = await deps.episodios(base, asesorUserId);
		// Ya tiene una alerta que le pide atender a este cliente: no se duplica.
		// Si la cerró y el cliente volvió a pedir un humano, es un episodio nuevo.
		if (abierto) continue;
		const llave = `${base}:ep:${total + 1}`;

		// El origen tiene que ser SU "escribió" de esta conversación: el de otro
		// asesor sería un hilo que no puede ver. Se busca al final a propósito:
		// el aviso inicial lo escribe el historial en background, así que cuanto
		// más tarde se mire, más probable es que ya esté.
		let origenId: string | null = null;
		if (params.origen.tipo === "referencia") {
			for (const numeroSifco of creditos) {
				origenId = await deps.buscarAviso(
					"bot_cliente_escribio",
					llaveDedupSesionBot(params.origen.sesionId, numeroSifco),
					asesorUserId,
				);
				if (origenId) break;
			}
		}

		await deps.insertar({
			titulo: "Tu cliente pidió hablar con un asesor",
			descripcion: describir(params.origen, destino, creditos),
			type: "reminder",
			status: "pending",
			cobrosTipo: "bot_modo_agente",
			cobrosDedupKey: llave,
			notificacionOrigenId: origenId,
			...destino.anclaCaso,
			// Mismo criterio que el aviso inicial: lo dispara el cliente, que no
			// es usuario del CRM, así que creador y destinatario son el asesor.
			createdBy: asesorUserId,
			createdByRole: "cobros",
			assignedToRole: "cobros",
			assignedTo: asesorUserId,
		});
		nuevos++;
	}

	return {
		ok: true,
		motivo: nuevos > 0 ? "NOTIFICADO" : "YA_NOTIFICADO",
		asesores: porAsesor.size,
	};
}

function describir(
	origen: OrigenModoAgente,
	destino: DestinoAvisoBot,
	creditos: string[],
): string {
	// Con un crédito, `quien` ya lo nombra; con varios, se listan todos. Sin
	// nombre del cliente, `quien` es "El crédito X" y no hay nombre que dejar.
	const lista = creditos.join(", ");
	const quien =
		creditos.length === 1
			? destino.quien
			: destino.quien.startsWith("El crédito ")
				? `El cliente de los créditos ${lista}`
				: `${destino.quien.replace(/\s*\(crédito [^)]*\)$/, "")} (créditos ${lista})`;
	// Sin identificarse, el número es lo que le permite encontrar el chat.
	const desde =
		origen.tipo === "telefono"
			? ` Escribió desde el ${origen.telefono8} sin identificarse en el bot.`
			: "";
	return `${quien} pasó a modo agente en el bot de WhatsApp y está esperando respuesta.${desde} Contestale desde Witty Agent o llamalo.`;
}
