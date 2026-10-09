/**
 * W2 (Workspace de cobros) · Solicitud de rebaja de mora.
 *
 *  · El asesor pide rebajar hasta la mora acumulada del caso, con notas.
 *  · El supervisor la aprueba (se aplica en cartera-back, de forma idempotente
 *    por el id de la solicitud) o la rechaza con una nota.
 *  · Cada paso avisa: al supervisor cuando se pide, al asesor cuando se decide.
 *  · Si la aplicación se interrumpe, un job la devuelve a `error_aplicacion` y
 *    avisa a los supervisores para que la repitan.
 *
 * Reglas puras (montos, clasificación de errores de cartera) en
 * lib/rebaja-mora-reglas.ts.
 */
import { and, eq, inArray, like, lt, or } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { carteraBackReferences } from "../db/schema/cartera-back";
import { casosCobros, solicitudesRebajaMoraCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	clasificarErrorCartera,
	type ErrorCarteraRebaja,
	PLAZO_APLICACION_REBAJA_MS,
	quetzalesRebaja,
} from "../lib/rebaja-mora-reglas";
import { CarteraBackHttpError, carteraBackClient } from "./cartera-back-client";
import { filasNotificacionCobros } from "./cobros-notif-helpers";
import {
	clienteDelCaso,
	decisoresPosibles,
} from "./recuperacion-solicitud-avisos";

export type EstadoRebaja =
	(typeof solicitudesRebajaMoraCobros.$inferSelect)["estado"];

/** Estados en los que la solicitud todavía no está cerrada. */
export const ESTADOS_REBAJA_ABIERTA = [
	"pendiente",
	"aprobada",
	"error_aplicacion",
] as const;

/** Estados desde los que el supervisor puede rechazar. */
export const ESTADOS_RECHAZABLES: EstadoRebaja[] = [
	"pendiente",
	"error_aplicacion",
];

/**
 * Estados desde los que el supervisor puede aprobar (o repetir la aprobación).
 * `aprobada` no está: es el estado en vuelo de quien ya reclamó la solicitud, y
 * si el proceso se cae el job la devuelve a `error_aplicacion`.
 */
export const ESTADOS_APROBABLES: EstadoRebaja[] = [
	"pendiente",
	"error_aplicacion",
];

const llaveSolicitud = (id: string) => `rebaja-solicitud:${id}`;
const llaveDecision = (id: string) => `rebaja-decision:${id}`;

async function intentar(etiqueta: string, fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		console.error(`[rebaja-mora] ${etiqueta}:`, error);
	}
}

/** SIFCO del caso y `credito_id` de cartera. `null` si el caso no tiene crédito. */
export async function creditoDelCasoRebaja(casoCobroId: string): Promise<{
	numeroSifco: string;
	creditoId: number | null;
} | null> {
	const [fila] = await db
		.select({
			numeroSifco: casosCobros.numeroCreditoSifco,
			creditoId: carteraBackReferences.carteraCreditoId,
		})
		.from(casosCobros)
		.leftJoin(
			carteraBackReferences,
			eq(
				carteraBackReferences.numeroCreditoSifco,
				casosCobros.numeroCreditoSifco,
			),
		)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!fila?.numeroSifco) return null;
	return { numeroSifco: fila.numeroSifco, creditoId: fila.creditoId ?? null };
}

/** Mora y estado EN VIVO de cartera (sin caché). Falla si cartera no responde. */
export async function leerCreditoVivo(numeroSifco: string): Promise<{
	mora: string;
	statusCredit: string | null;
}> {
	const credito = await carteraBackClient.getCredito(numeroSifco, false);
	return {
		mora: credito.moraActual ?? "0",
		statusCredit: credito.credito?.statusCredit ?? null,
	};
}

export async function leerSolicitudRebaja(id: string) {
	const [fila] = await db
		.select()
		.from(solicitudesRebajaMoraCobros)
		.where(eq(solicitudesRebajaMoraCobros.id, id))
		.limit(1);
	return fila ?? null;
}

async function nombreDe(userId: string | null): Promise<string | null> {
	if (!userId) return null;
	const [fila] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return fila?.name ?? null;
}

/* ── Avisos ─────────────────────────────────────────────────────────────── */

/** Solicitud nueva → supervisores que la pueden decidir (nadie decide la suya). */
export async function avisarRebajaPendiente(params: {
	solicitudId: string;
	casoCobroId: string;
	solicitanteId: string;
	monto: string;
	mora: string;
	notas: string;
}): Promise<void> {
	await intentar(`aviso de la solicitud ${params.solicitudId}`, async () => {
		const supervisores = await decisoresPosibles(params.solicitanteId);
		if (supervisores.length === 0) return;
		const [{ cliente, numeroSifco }, solicitante] = await Promise.all([
			clienteDelCaso(params.casoCobroId),
			nombreDe(params.solicitanteId),
		]);
		const quien = solicitante ? `${solicitante} (asesor)` : "Un asesor";
		const titulo = `Rebaja de mora por aprobar: ${quetzalesRebaja(params.monto)}`;
		const descripcion = `${quien} pide rebajar ${quetzalesRebaja(params.monto)} de la mora de ${quetzalesRebaja(params.mora)}${cliente ? ` del cliente ${cliente}` : ""} (crédito ${numeroSifco}). Motivo: ${params.notas}`;
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "rebaja_pendiente_aprobacion",
			titulo,
			descripcion,
			asesorUserId: null,
			supervisores,
			usuarioSistema: params.solicitanteId,
			dedupKey: llaveSolicitud(params.solicitudId),
			type: "action_required",
		});
		await db.transaction(async (tx) => {
			const [fila] = await tx
				.select({ estado: solicitudesRebajaMoraCobros.estado })
				.from(solicitudesRebajaMoraCobros)
				.where(eq(solicitudesRebajaMoraCobros.id, params.solicitudId))
				.for("update")
				.limit(1);
			// Si ya se decidió mientras se armaba el aviso, no se inserta: el cierre
			// de avisos ya corrió y esta fila quedaría huérfana.
			if (fila?.estado !== "pendiente") return;
			await tx.insert(notifications).values(filas).onConflictDoNothing();
		});
	});
}

/**
 * Cierra los avisos de «por aprobar» de la solicitud, incluidos los de aprobación
 * interrumpida (su llave empieza igual, con un sufijo).
 */
export async function cerrarAvisosRebaja(solicitudId: string): Promise<void> {
	const llave = llaveSolicitud(solicitudId);
	await intentar(`cierre de avisos de ${solicitudId}`, () =>
		db
			.update(notifications)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notifications.cobrosTipo, "rebaja_pendiente_aprobacion"),
					or(
						eq(notifications.cobrosDedupKey, llave),
						like(notifications.cobrosDedupKey, `${llave}:%`),
					),
					inArray(notifications.status, ["pending", "read", "in_progress"]),
				),
			),
	);
}

/** La decisión, de vuelta a quien la pidió (si no la tomó él mismo). */
export async function avisarDecisionRebaja(params: {
	solicitudId: string;
	casoCobroId: string;
	decision: "aplicada" | "rechazada" | "cancelada";
	solicitanteId: string | null;
	decidioPorId: string | null;
	monto: string;
	nota: string | null;
}): Promise<void> {
	await cerrarAvisosRebaja(params.solicitudId);
	if (!params.solicitanteId || params.solicitanteId === params.decidioPorId) {
		return;
	}
	const solicitanteId = params.solicitanteId;
	await intentar(`aviso de la decisión de ${params.solicitudId}`, async () => {
		const [{ cliente, numeroSifco }, decidioPor] = await Promise.all([
			clienteDelCaso(params.casoCobroId),
			nombreDe(params.decidioPorId),
		]);
		const quien = decidioPor ?? "El supervisor";
		const cabeza =
			params.decision === "aplicada"
				? `Rebaja de mora aprobada: ${quetzalesRebaja(params.monto)}`
				: params.decision === "rechazada"
					? `Rebaja de mora rechazada: ${quetzalesRebaja(params.monto)}`
					: `Rebaja de mora cancelada: ${quetzalesRebaja(params.monto)}`;
		const detalle =
			params.decision === "aplicada"
				? `${quien} la aprobó y ya se aplicó en cartera${cliente ? ` (${cliente}, crédito ${numeroSifco})` : ""}.`
				: `${quien} la ${params.decision === "rechazada" ? "rechazó" : "canceló"}${cliente ? ` (${cliente}, crédito ${numeroSifco})` : ""}.`;
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "rebaja_resuelta",
			titulo: cabeza,
			descripcion: params.nota ? `${detalle} Nota: ${params.nota}` : detalle,
			asesorUserId: solicitanteId,
			supervisores: [],
			usuarioSistema: params.decidioPorId ?? solicitanteId,
			dedupKey: llaveDecision(params.solicitudId),
		});
		await db.insert(notifications).values(filas).onConflictDoNothing();
	});
}

/* ── Aplicación en cartera ─────────────────────────────────────────────── */

export type ResultadoAplicacion =
	| {
			ok: true;
			moraNueva: string;
			condonacionId: number | null;
			/** Cartera ya la había aplicado (reintento tras perder la respuesta). */
			yaAplicada: boolean;
	  }
	| { ok: false; definitivo: boolean; motivo: string };

/**
 * Descuenta la rebaja en cartera. Idempotente por el id de la solicitud: un
 * reintento tras un fallo no descuenta dos veces. El fallo se clasifica con
 * `clasificarErrorCartera`: definitivo (la solicitud se rechaza) o transitorio
 * (se puede repetir la aprobación).
 */
export async function aplicarRebajaEnCartera(params: {
	solicitud: { id: string; montoSolicitado: string; notas: string };
	creditoId: number;
	emailSupervisor: string;
}): Promise<ResultadoAplicacion> {
	try {
		const r = await carteraBackClient.condonarMoraParcial({
			creditoId: params.creditoId,
			monto: params.solicitud.montoSolicitado,
			motivo: `Rebaja de mora aprobada por ${params.emailSupervisor}: ${params.solicitud.notas}`,
			usuarioEmail: params.emailSupervisor,
			referenciaExterna: params.solicitud.id,
			signal: AbortSignal.timeout(PLAZO_APLICACION_REBAJA_MS),
		});
		return {
			ok: true,
			moraNueva: r.mora_nueva ?? "",
			condonacionId: r.condonacion_id ?? null,
			yaAplicada: r.kind === "ya_aplicada",
		};
	} catch (error) {
		const clasificacion = clasificarErrorCartera(
			error instanceof CarteraBackHttpError
				? {
						status: error.status,
						payload: error.payload as ErrorCarteraRebaja["payload"],
					}
				: { status: null },
		);
		if (clasificacion.tipo === "transitorio") {
			console.error(
				"[rebaja-mora] cartera no aplicó la rebaja (transitorio):",
				error,
			);
		}
		return {
			ok: false,
			definitivo: clasificacion.tipo === "definitivo",
			motivo: clasificacion.motivo,
		};
	}
}

/* ── Aprobaciones interrumpidas ────────────────────────────────────────── */

/**
 * Las aprobaciones que quedaron en `aprobada` más de `umbralMs` (el proceso se
 * cayó antes de la respuesta de cartera) pasan a `error_aplicacion` y se avisa a
 * los supervisores. Reintentar es seguro: cartera es idempotente por el id.
 * Devuelve cuántas cerró.
 */
export async function marcarAprobacionesColgadas(
	ahora: Date,
	umbralMs: number,
): Promise<number> {
	const corte = new Date(ahora.getTime() - umbralMs);
	const colgadas = await db
		.update(solicitudesRebajaMoraCobros)
		.set({
			estado: "error_aplicacion",
			notaResolucion:
				"La aplicación en cartera se interrumpió antes de terminar. Puede aprobarla de nuevo.",
		})
		.where(
			and(
				eq(solicitudesRebajaMoraCobros.estado, "aprobada"),
				lt(solicitudesRebajaMoraCobros.resueltoEn, corte),
			),
		)
		.returning({
			id: solicitudesRebajaMoraCobros.id,
			casoCobroId: solicitudesRebajaMoraCobros.casoCobroId,
			solicitadoPor: solicitudesRebajaMoraCobros.solicitadoPor,
			montoSolicitado: solicitudesRebajaMoraCobros.montoSolicitado,
			resueltoEn: solicitudesRebajaMoraCobros.resueltoEn,
		});

	for (const s of colgadas) {
		await intentar(`aviso de aprobación interrumpida ${s.id}`, async () => {
			const supervisores = await decisoresPosibles(s.solicitadoPor ?? "");
			if (supervisores.length === 0) return;
			const { cliente, numeroSifco } = await clienteDelCaso(s.casoCobroId);
			const filas = filasNotificacionCobros({
				casoId: s.casoCobroId,
				cobrosTipo: "rebaja_pendiente_aprobacion",
				titulo: `Aprobación de rebaja interrumpida: ${quetzalesRebaja(s.montoSolicitado)}`,
				descripcion: `La rebaja de ${cliente ?? `el crédito ${numeroSifco}`} no terminó de aplicarse en cartera. Puede aprobarla de nuevo: cartera no la descuenta dos veces.`,
				asesorUserId: null,
				supervisores,
				usuarioSistema: s.solicitadoPor ?? supervisores[0] ?? "",
				dedupKey: `${llaveSolicitud(s.id)}:interrumpida:${(s.resueltoEn ?? ahora).getTime()}`,
				type: "action_required",
			});
			// Bajo candado de la fila y solo si sigue en error_aplicacion: mientras se
			// armaba el aviso un supervisor pudo reintentar o rechazar, y esta alerta
			// (que no se resuelve a mano) quedaría huérfana.
			await db.transaction(async (tx) => {
				const [fila] = await tx
					.select({ estado: solicitudesRebajaMoraCobros.estado })
					.from(solicitudesRebajaMoraCobros)
					.where(eq(solicitudesRebajaMoraCobros.id, s.id))
					.for("update")
					.limit(1);
				if (fila?.estado !== "error_aplicacion") return;
				await tx.insert(notifications).values(filas).onConflictDoNothing();
			});
		});
	}
	return colgadas.length;
}
