/**
 * W3 (Workspace de cobros) · Escalar a Jurídico con aprobación del supervisor.
 *
 *  · El asesor pide escalar un caso de B3 o B4, con un motivo y una nota para
 *    Jurídico. Avisa a los supervisores que la pueden decidir.
 *  · El supervisor lo aprueba: cartera-back clava el crédito en B5 y lo saca de
 *    la cartera del asesor (ese traslado vive allá, no aquí). O lo rechaza.
 *  · La decisión vuelve al asesor. Todo best-effort, igual que la recuperación.
 */
import { and, eq, inArray, like, lt, or } from "drizzle-orm";
import { db } from "../db";
import { solicitudesJuridicoCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	clasificarErrorCartera,
	type ErrorCarteraRebaja,
} from "../lib/rebaja-mora-reglas";
import { CarteraBackHttpError, carteraBackClient } from "./cartera-back-client";
import { filasNotificacionCobros } from "./cobros-notif-helpers";
import {
	clienteDelCaso,
	decisoresPosibles,
} from "./recuperacion-solicitud-avisos";

export const MOTIVOS_JURIDICO = [
	"no_contacto",
	"no_quiere_pagar",
	"sin_acuerdo",
] as const;
export type MotivoJuridico = (typeof MOTIVOS_JURIDICO)[number];

const ETIQUETA_MOTIVO: Record<MotivoJuridico, string> = {
	no_contacto: "No contacto",
	no_quiere_pagar: "No quiere pagar",
	sin_acuerdo: "Sin acuerdo",
};

/** Estados en los que la solicitud todavía no está cerrada. */
export const ESTADOS_JURIDICO_ABIERTA = [
	"pendiente",
	"aprobada",
	"error_aplicacion",
] as const;

const llaveSolicitud = (id: string) => `juridico-solicitud:${id}`;
const llaveDecision = (id: string) => `juridico-decision:${id}`;

async function intentar(etiqueta: string, fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		console.error(`[juridico-solicitud] ${etiqueta}:`, error);
	}
}

/** Avisos a los supervisores cuando se pide el escalado. */
export async function avisarEscalamientoPendiente(params: {
	solicitudId: string;
	casoCobroId: string;
	solicitanteId: string;
	motivo: MotivoJuridico;
	notaJuridico: string;
	bucket: number;
}): Promise<void> {
	await intentar(`aviso de la solicitud ${params.solicitudId}`, async () => {
		const supervisores = await decisoresPosibles(params.solicitanteId);
		if (supervisores.length === 0) return;
		const { cliente, numeroSifco } = await clienteDelCaso(params.casoCobroId);
		const titulo = `Escalar a Jurídico por aprobar: ${cliente ?? `crédito ${numeroSifco}`}`;
		const descripcion = `El asesor pide pasar el caso a Jurídico desde B${params.bucket}. Motivo: ${ETIQUETA_MOTIVO[params.motivo]}. Nota para Jurídico: ${params.notaJuridico}`;
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "juridico_pendiente_aprobacion",
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
				.select({ estado: solicitudesJuridicoCobros.estado })
				.from(solicitudesJuridicoCobros)
				.where(eq(solicitudesJuridicoCobros.id, params.solicitudId))
				.for("update")
				.limit(1);
			// Decidida mientras se armaba el aviso: no se inserta (quedaría huérfano).
			if (fila?.estado !== "pendiente") return;
			await tx.insert(notifications).values(filas).onConflictDoNothing();
		});
	});
}

/** Cierra los avisos de «por aprobar» de esa solicitud. */
export async function cerrarAvisosJuridico(solicitudId: string): Promise<void> {
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
					eq(notifications.cobrosTipo, "juridico_pendiente_aprobacion"),
					or(
						// El aviso de una aprobación interrumpida lleva un sufijo en el
						// dedupKey (ver marcarEscalamientosColgados): también se cierra.
						eq(notifications.cobrosDedupKey, llaveSolicitud(solicitudId)),
						like(
							notifications.cobrosDedupKey,
							`${llaveSolicitud(solicitudId)}:%`,
						),
					),
					inArray(notifications.status, ["pending", "read", "in_progress"]),
				),
			),
	);
}

/** La decisión, de vuelta al asesor (si no la tomó él mismo). */
export async function avisarDecisionJuridico(params: {
	solicitudId: string;
	casoCobroId: string;
	decision: "aplicada" | "rechazada" | "cancelada";
	solicitanteId: string | null;
	decidioPorId: string | null;
	nota: string | null;
}): Promise<void> {
	await cerrarAvisosJuridico(params.solicitudId);
	if (!params.solicitanteId || params.solicitanteId === params.decidioPorId)
		return;
	const solicitanteId = params.solicitanteId;
	await intentar(`aviso de la decisión de ${params.solicitudId}`, async () => {
		const { cliente, numeroSifco } = await clienteDelCaso(params.casoCobroId);
		const caso = cliente ?? `crédito ${numeroSifco}`;
		const titulo =
			params.decision === "aplicada"
				? `Caso a Jurídico: ${caso}`
				: params.decision === "rechazada"
					? `Escalado a Jurídico rechazado: ${caso}`
					: `Escalado a Jurídico cancelado: ${caso}`;
		const descripcion =
			params.decision === "aplicada"
				? `El caso salió de su cartera y pasó a Jurídico (B5). Ya no aparece en su cola.${params.nota ? ` Nota: ${params.nota}` : ""}`
				: `${params.decision === "rechazada" ? "El supervisor lo rechazó" : "Se canceló la solicitud"}.${params.nota ? ` Nota: ${params.nota}` : ""}`;
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "juridico_resuelto",
			titulo,
			descripcion,
			asesorUserId: solicitanteId,
			supervisores: [],
			usuarioSistema: params.decidioPorId ?? solicitanteId,
			dedupKey: llaveDecision(params.solicitudId),
		});
		await db.insert(notifications).values(filas).onConflictDoNothing();
	});
}

export type ResultadoEscalamiento =
	| { ok: true }
	| { ok: false; definitivo: boolean; motivo: string };

/**
 * Clava el crédito en B5 en cartera. Un 409 `ya_en_juridico` es éxito (reintento
 * de una aprobación cuya respuesta se perdió). Otro 4xx es definitivo; un 5xx o
 * un fallo de red se puede reintentar.
 */
export async function aplicarEscalamientoEnCartera(params: {
	creditoId: number;
	motivo: string;
	emailSupervisor: string;
}): Promise<ResultadoEscalamiento> {
	try {
		await carteraBackClient.enviarAJuridico({
			creditoId: params.creditoId,
			motivo: params.motivo,
			usuarioEmail: params.emailSupervisor,
		});
		return { ok: true };
	} catch (error) {
		if (error instanceof CarteraBackHttpError) {
			const payload = error.payload as ErrorCarteraRebaja["payload"];
			// Reintento de una aprobación cuya respuesta se perdió: ya quedó aplicado.
			if (error.status === 409 && payload?.codigo === "ya_en_juridico") {
				return { ok: true };
			}
			const c = clasificarErrorCartera({ status: error.status, payload });
			if (c.tipo === "transitorio") {
				console.error(
					"[juridico-solicitud] cartera no aplicó el escalado (transitorio):",
					error,
				);
			}
			return {
				ok: false,
				definitivo: c.tipo === "definitivo",
				motivo: c.motivo,
			};
		}
		console.error("[juridico-solicitud] cartera no aplicó el escalado:", error);
		const c = clasificarErrorCartera({ status: null });
		return { ok: false, definitivo: false, motivo: c.motivo };
	}
}

/* ── Aprobaciones interrumpidas (H4 de la revisión) ─────────────────────── */

/**
 * Las escalaciones que quedaron en `aprobada` más de `umbralMs` (el proceso se
 * cayó entre el reclamo y la respuesta de cartera) pasan a `error_aplicacion` y
 * se avisa a los supervisores. Reintentar es seguro: cartera responde
 * `ya_en_juridico` si el crédito ya quedó clavado en B5. Devuelve cuántas cerró.
 */
export async function marcarEscalamientosColgados(
	ahora: Date,
	umbralMs: number,
): Promise<number> {
	const corte = new Date(ahora.getTime() - umbralMs);
	const colgadas = await db
		.update(solicitudesJuridicoCobros)
		.set({
			estado: "error_aplicacion",
			notaResolucion:
				"La aplicación en cartera se interrumpió antes de terminar. Puede aprobarla de nuevo.",
		})
		.where(
			and(
				eq(solicitudesJuridicoCobros.estado, "aprobada"),
				lt(solicitudesJuridicoCobros.resueltoEn, corte),
			),
		)
		.returning({
			id: solicitudesJuridicoCobros.id,
			casoCobroId: solicitudesJuridicoCobros.casoCobroId,
			solicitadoPor: solicitudesJuridicoCobros.solicitadoPor,
			resueltoEn: solicitudesJuridicoCobros.resueltoEn,
		});

	for (const s of colgadas) {
		await intentar(`aviso de aprobación interrumpida ${s.id}`, async () => {
			const supervisores = await decisoresPosibles(s.solicitadoPor ?? "");
			if (supervisores.length === 0) return;
			const { cliente, numeroSifco } = await clienteDelCaso(s.casoCobroId);
			const caso = cliente ?? `crédito ${numeroSifco}`;
			const filas = filasNotificacionCobros({
				casoId: s.casoCobroId,
				cobrosTipo: "juridico_pendiente_aprobacion",
				titulo: `Escalado a Jurídico interrumpido: ${caso}`,
				descripcion: `El escalado de ${caso} a Jurídico no terminó de aplicarse en cartera. Puede aprobarlo de nuevo: cartera no lo aplica dos veces.`,
				asesorUserId: null,
				supervisores,
				usuarioSistema: s.solicitadoPor ?? supervisores[0] ?? "",
				dedupKey: `${llaveSolicitud(s.id)}:interrumpida:${(s.resueltoEn ?? ahora).getTime()}`,
				type: "action_required",
			});
			await db.insert(notifications).values(filas).onConflictDoNothing();
		});
	}
	return colgadas.length;
}

export { ETIQUETA_MOTIVO };
