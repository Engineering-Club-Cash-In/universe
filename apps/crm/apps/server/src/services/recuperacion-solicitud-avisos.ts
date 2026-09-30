/**
 * CB-043 · Avisos de la solicitud de recuperación, y el cierre de las que
 * quedan sin efecto. Mismo patrón que services/inmovilizacion-notif.ts:
 *
 *  · la solicitud nueva va a TODOS los cobros_supervisor como acción requerida;
 *  · al decidirse (o cancelarse, o quedar sin efecto) esos avisos se cierran,
 *    para que ningún supervisor abra algo que ya no está pendiente;
 *  · la decisión vuelve a quien la pidió.
 *
 * Todo best-effort: un aviso que no sale nunca deshace una decisión ya tomada.
 * Archivo aparte de services/recuperacion-vehiculo.ts para que ese servicio
 * pueda cerrar las solicitudes pendientes al trasladar sin importar el de las
 * solicitudes (que a su vez importa de él).
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	contratosFinanciamiento,
	recuperacionesVehiculo,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import { notifications } from "../db/schema/notifications";
import {
	textoAvisoDecisionRecuperacion,
	textoAvisoSolicitudRecuperacion,
} from "../lib/recuperacion-solicitud";
import {
	filasNotificacionCobros,
	obtenerSupervisoresCobros,
} from "./cobros-notif-helpers";

const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

const llaveSolicitud = (registroId: string) =>
	`recuperacion-solicitud:${registroId}`;
const llaveDecision = (registroId: string) =>
	`recuperacion-decision:${registroId}`;

async function intentar(etiqueta: string, fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		console.error(`[recuperacion-solicitud] ${etiqueta}:`, error);
	}
}

/** Nombre del cliente y SIFCO del caso, del CRM (sin ir a cartera). */
export async function clienteDelCaso(casoCobroId: string): Promise<{
	cliente: string | null;
	numeroSifco: string;
}> {
	const [fila] = await db
		.select({
			cliente: clients.contactPerson,
			numeroSifco: casosCobros.numeroCreditoSifco,
		})
		.from(casosCobros)
		.leftJoin(
			contratosFinanciamiento,
			eq(casosCobros.contratoId, contratosFinanciamiento.id),
		)
		.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	return {
		cliente: fila?.cliente?.trim() || null,
		numeroSifco: fila?.numeroSifco ?? "sin SIFCO",
	};
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

/**
 * Quién puede decidir una solicitud: los cobros_supervisor menos quien la
 * pidió (nadie decide la suya). Si no queda ninguno —la pidió el único
 * supervisor—, los admins, para que no quede una solicitud que nadie ve.
 */
async function decisoresPosibles(solicitanteId: string): Promise<string[]> {
	const supervisores = (await obtenerSupervisoresCobros()).filter(
		(id) => id !== solicitanteId,
	);
	if (supervisores.length > 0) return supervisores;
	const admins = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "admin"));
	return admins.map((a) => a.id).filter((id) => id !== solicitanteId);
}

/**
 * Solicitud nueva → quienes la pueden decidir (`decisoresPosibles`). El INSERT va
 * en una transacción que primero bloquea la fila de la solicitud y confirma que
 * sigue pendiente: si un supervisor decidió en el medio, `resolverAvisos` ya
 * corrió y un aviso insertado después quedaría huérfano para siempre (la misma
 * carrera que resolvió CB-041, review de Codex del PR #1758).
 */
export async function avisarSolicitudPendiente(params: {
	registroId: string;
	casoCobroId: string;
	bucket: number | null;
	solicitanteId: string;
	resumen: string;
}): Promise<void> {
	await intentar(`aviso de la solicitud ${params.registroId}`, async () => {
		const supervisores = await decisoresPosibles(params.solicitanteId);
		if (supervisores.length === 0) return;
		const [{ cliente, numeroSifco }, solicitante] = await Promise.all([
			clienteDelCaso(params.casoCobroId),
			nombreDe(params.solicitanteId),
		]);
		const { titulo, descripcion } = textoAvisoSolicitudRecuperacion({
			cliente,
			numeroSifco,
			bucket: params.bucket,
			solicitante,
			resumen: params.resumen,
		});
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "recuperacion_pendiente_aprobacion",
			titulo,
			descripcion,
			asesorUserId: null,
			supervisores,
			usuarioSistema: params.solicitanteId,
			dedupKey: llaveSolicitud(params.registroId),
			type: "action_required",
		});
		await db.transaction(async (tx) => {
			const [fila] = await tx
				.select({ estado: recuperacionesVehiculo.estadoSolicitud })
				.from(recuperacionesVehiculo)
				.where(eq(recuperacionesVehiculo.id, params.registroId))
				.for("update")
				.limit(1);
			if (fila?.estado !== "pendiente") return;
			await tx.insert(notifications).values(filas).onConflictDoNothing();
		});
	});
}

/** Cierra los avisos de "solicitud pendiente" de ESA solicitud. */
export async function resolverAvisosSolicitud(
	registroId: string,
): Promise<void> {
	await intentar(`cierre de avisos de ${registroId}`, () =>
		db
			.update(notifications)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notifications.cobrosTipo, "recuperacion_pendiente_aprobacion"),
					eq(notifications.cobrosDedupKey, llaveSolicitud(registroId)),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			),
	);
}

/** La decisión, de vuelta a quien pidió (si no la tomó él mismo). */
export async function avisarDecisionSolicitud(params: {
	registroId: string;
	casoCobroId: string;
	decision: "aprobada" | "rechazada" | "sin_efecto";
	solicitanteId: string | null;
	decidioPorId: string | null;
	motivo: string | null;
}): Promise<void> {
	await resolverAvisosSolicitud(params.registroId);
	if (!params.solicitanteId || params.solicitanteId === params.decidioPorId) {
		return;
	}
	const solicitanteId = params.solicitanteId;
	await intentar(`aviso de la decisión de ${params.registroId}`, async () => {
		const [{ cliente, numeroSifco }, decidioPor] = await Promise.all([
			clienteDelCaso(params.casoCobroId),
			nombreDe(params.decidioPorId),
		]);
		const { titulo, descripcion } = textoAvisoDecisionRecuperacion({
			decision: params.decision,
			cliente,
			numeroSifco,
			decidioPor,
			motivo: params.motivo,
		});
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "recuperacion_resuelta",
			titulo,
			descripcion,
			asesorUserId: solicitanteId,
			supervisores: [],
			usuarioSistema: params.decidioPorId ?? solicitanteId,
			dedupKey: llaveDecision(params.registroId),
		});
		await db.insert(notifications).values(filas).onConflictDoNothing();
	});
}

/**
 * El crédito ya se trasladó a B4 por otro camino (una entrega voluntaria, un
 * supervisor que lo mandó directo, "deshacer convenio y mandar"): la solicitud
 * pendiente del caso deja de tener sentido. Se cierra como sin efecto y se le
 * avisa a quien la pidió.
 */
export async function cerrarSolicitudesPendientesDelCaso(params: {
	casoCobroId: string;
	exceptoId: string;
	motivo: string;
	actorId: string;
}): Promise<void> {
	let cerradas: { id: string; registradoPor: string | null }[] = [];
	try {
		cerradas = await db
			.update(recuperacionesVehiculo)
			.set({
				estadoSolicitud: "sin_efecto",
				motivoDecision: params.motivo,
				decididoAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(recuperacionesVehiculo.casoCobroId, params.casoCobroId),
					eq(recuperacionesVehiculo.estadoSolicitud, "pendiente"),
					ne(recuperacionesVehiculo.id, params.exceptoId),
				),
			)
			.returning({
				id: recuperacionesVehiculo.id,
				registradoPor: recuperacionesVehiculo.registradoPor,
			});
	} catch (error) {
		console.error(
			`[recuperacion-solicitud] No se pudieron cerrar las solicitudes pendientes del caso ${params.casoCobroId}:`,
			error,
		);
		return;
	}
	for (const s of cerradas) {
		await avisarDecisionSolicitud({
			registroId: s.id,
			casoCobroId: params.casoCobroId,
			decision: "sin_efecto",
			solicitanteId: s.registradoPor,
			decidioPorId: params.actorId,
			motivo: params.motivo,
		});
	}
}
