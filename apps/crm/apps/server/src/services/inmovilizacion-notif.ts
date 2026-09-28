// CB-041 — Notificaciones del flujo de inmovilización (apagado/reactivación
// de unidad). Mismo patrón que services/convenio-decision-notif.ts:
//
// Todo acá es best-effort: un fallo de notificación NUNCA hace fallar la
// acción de negocio (solicitar/decidir/ejecutar/llamar). A diferencia de
// convenios, acá no hay una carrera con un sistema EXTERNO (cartera-back),
// pero SÍ existe una ventana interna: la solicitud se crea en su propia
// transacción (router) y notificarInmovilizacionPendiente corre DESPUÉS,
// fuera de ella. Si un supervisor decide en esa ventana, resolverPendientes
// (llamado por la decisión) corre antes de que el aviso pendiente exista —
// no encuentra nada que cerrar, y el INSERT de acá lo crea igual, ya
// huérfano y `pending` para siempre. notificarInmovilizacionPendiente
// re-chequea el estado justo antes de insertar para cerrar esa ventana.
// Review de Codex, PR #1758.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { notifications } from "../db/schema/notifications";
import { obtenerSupervisoresCobros } from "./cobros-notif-helpers";

type RolNotificacion = (typeof notifications.createdByRole.enumValues)[number];

/**
 * Estados NO terminales de una notificación — mismo criterio que
 * convenio-decision-notif.ts: solo `resolved`/`dismissed` la sacan de
 * circulación, y "marcar todas como leídas" no debe dejarla mostrándose como
 * acción pendiente.
 */
const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

function tryNotify(label: string, fn: () => Promise<unknown>): Promise<void> {
	return fn()
		.then(() => undefined)
		.catch((error) => {
			console.warn(
				`[${label}] No se pudo notificar (best-effort):`,
				error instanceof Error ? error.message : error,
			);
		});
}

/**
 * Al solicitar apagado/reactivación: avisa a TODOS los cobros_supervisor.
 */
export async function notificarInmovilizacionPendiente(params: {
	inmovilizacionId: string;
	casoCobroId: string;
	accion: "apagado" | "reactivacion";
	clienteNombre?: string;
	numeroCreditoSifco?: string;
	motivo: string;
	solicitadoPorUserId: string;
	solicitadoPorRole?: RolNotificacion;
}): Promise<void> {
	await tryNotify("notificarInmovilizacionPendiente", async () => {
		// Re-chequeo justo antes de insertar: si un supervisor ya decidió (o
		// el solicitante canceló) en la ventana entre el commit de la
		// solicitud y esta llamada, no queda nada "pendiente" que avisar —
		// insertar igual dejaría un aviso pending huérfano. Ver comentario
		// del encabezado del archivo.
		const [inm] = await db
			.select({ estado: inmovilizacionesUnidad.estado })
			.from(inmovilizacionesUnidad)
			.where(eq(inmovilizacionesUnidad.id, params.inmovilizacionId))
			.limit(1);
		if (inm?.estado !== "pendiente_aprobacion") return;

		const supervisores = await obtenerSupervisoresCobros();
		if (supervisores.length === 0) return;

		const accionTexto =
			params.accion === "apagado" ? "apagado" : "reactivación";
		const quien = params.clienteNombre?.trim()
			? params.numeroCreditoSifco
				? `${params.clienteNombre.trim()} (crédito ${params.numeroCreditoSifco})`
				: params.clienteNombre.trim()
			: params.numeroCreditoSifco
				? `El crédito ${params.numeroCreditoSifco}`
				: "Un cliente";

		await db.insert(notifications).values(
			supervisores.map((supervisorId) => ({
				titulo: `Solicitud de ${accionTexto} pendiente de aprobación`,
				descripcion: `${quien} tiene una solicitud de ${accionTexto} de unidad esperando aprobación. Motivo: ${params.motivo}.`,
				type: "action_required" as const,
				status: "pending" as const,
				cobrosTipo: "inmovilizacion_pendiente_aprobacion" as const,
				relatedEntityType: "collection_case" as const,
				relatedEntityId: params.casoCobroId,
				inmovilizacionId: params.inmovilizacionId,
				redirectPage: "cobros_detail" as const,
				createdBy: params.solicitadoPorUserId,
				createdByRole: params.solicitadoPorRole ?? ("cobros" as const),
				assignedToRole: "cobros_supervisor" as const,
				assignedTo: supervisorId,
			})),
		);
	});
}

/**
 * Cierra los avisos `inmovilizacion_pendiente_aprobacion` DE ESA
 * inmovilización — una vez decidida, el resto de supervisores no debe
 * seguir viendo una acción requerida sobre algo que ya no está pendiente.
 */
export async function resolverPendientesInmovilizacion(
	inmovilizacionId: string,
): Promise<void> {
	// Best-effort igual que los INSERT: la transición ya está commiteada y
	// un fallo al cerrar avisos no puede devolverla como error al usuario.
	await tryNotify("resolverPendientesInmovilizacion", () =>
		db
			.update(notifications)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notifications.cobrosTipo, "inmovilizacion_pendiente_aprobacion"),
					eq(notifications.inmovilizacionId, inmovilizacionId),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			),
	);
}

/**
 * Al aprobar/rechazar: avisa al asesor que solicitó. El rechazo lleva el
 * motivo del supervisor.
 */
export async function notificarInmovilizacionResuelta(params: {
	inmovilizacionId: string;
	casoCobroId: string;
	accion: "apagado" | "reactivacion";
	decision: "aprobada" | "rechazada";
	motivoRechazo?: string | null;
	solicitanteUserId: string;
	decididoPorUserId: string;
	decididoPorRole?: RolNotificacion;
}): Promise<void> {
	await tryNotify("notificarInmovilizacionResuelta", async () => {
		const accionTexto =
			params.accion === "apagado" ? "apagado" : "reactivación";
		const titulo =
			params.decision === "aprobada"
				? `Solicitud de ${accionTexto} aprobada`
				: `Solicitud de ${accionTexto} rechazada`;
		const descripcion =
			params.decision === "aprobada"
				? `El supervisor aprobó la solicitud de ${accionTexto} de unidad.`
				: `El supervisor rechazó la solicitud de ${accionTexto} de unidad. Motivo: ${params.motivoRechazo ?? "sin especificar"}.`;

		await db.insert(notifications).values({
			titulo,
			descripcion,
			type: "aviso" as const,
			status: "pending" as const,
			cobrosTipo: "inmovilizacion_resuelta" as const,
			relatedEntityType: "collection_case" as const,
			relatedEntityId: params.casoCobroId,
			inmovilizacionId: params.inmovilizacionId,
			redirectPage: "cobros_detail" as const,
			createdBy: params.decididoPorUserId,
			createdByRole: params.decididoPorRole ?? ("cobros_supervisor" as const),
			assignedToRole: "cobros" as const,
			assignedTo: params.solicitanteUserId,
		});
	});

	await resolverPendientesInmovilizacion(params.inmovilizacionId);
}

/**
 * Al ejecutar un APAGADO: avisa al asesor dueño del caso que debe llamar al
 * cliente. Queda `pending`/`action_required` hasta que
 * `registrarResultadoLlamada` la resuelva.
 */
export async function notificarLlamarCliente(params: {
	inmovilizacionId: string;
	casoCobroId: string;
	asesorUserId: string;
	clienteNombre?: string;
	ejecutadoPorUserId: string;
	ejecutadoPorRole?: RolNotificacion;
}): Promise<void> {
	await tryNotify("notificarLlamarCliente", async () => {
		const quien = params.clienteNombre?.trim() || "El cliente";
		await db.insert(notifications).values({
			titulo: "Llamar al cliente: unidad apagada",
			descripcion: `Se ejecutó el apagado de la unidad. Llamá a ${quien} y registrá el resultado en la Ficha 360.`,
			type: "action_required" as const,
			status: "pending" as const,
			cobrosTipo: "inmovilizacion_llamar_cliente" as const,
			relatedEntityType: "collection_case" as const,
			relatedEntityId: params.casoCobroId,
			inmovilizacionId: params.inmovilizacionId,
			redirectPage: "cobros_detail" as const,
			createdBy: params.ejecutadoPorUserId,
			createdByRole: params.ejecutadoPorRole ?? ("cobros_supervisor" as const),
			assignedToRole: "cobros" as const,
			assignedTo: params.asesorUserId,
		});
	});
}

/**
 * Al registrar el resultado de la llamada: cierra el aviso
 * `inmovilizacion_llamar_cliente` de esa inmovilización.
 */
export async function resolverAvisoLlamarCliente(
	inmovilizacionId: string,
): Promise<void> {
	await tryNotify("resolverAvisoLlamarCliente", () =>
		db
			.update(notifications)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notifications.cobrosTipo, "inmovilizacion_llamar_cliente"),
					eq(notifications.inmovilizacionId, inmovilizacionId),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			),
	);
}

/**
 * Al ejecutar una REACTIVACIÓN: avisa al asesor dueño del caso que LEGION ya
 * restableció la unidad y que debe llamar al cliente a confirmarlo. Mismo
 * patrón que `notificarLlamarCliente` para el apagado (action_required, no
 * un aviso pasivo): el asesor cierra el ciclo llamando y registrando la
 * gestión, no solo leyendo la notificación — comparte `cobrosTipo` con esa
 * para que `resolverAvisoLlamarCliente` la cierre igual.
 */
export async function notificarUnidadReactivada(params: {
	inmovilizacionId: string;
	casoCobroId: string;
	asesorUserId: string;
	clienteNombre?: string;
	ejecutadoPorUserId: string;
	ejecutadoPorRole?: RolNotificacion;
}): Promise<void> {
	await tryNotify("notificarUnidadReactivada", async () => {
		const quien = params.clienteNombre?.trim() || "el cliente";
		await db.insert(notifications).values({
			titulo: "Llamar al cliente: unidad reactivada",
			descripcion: `LEGION ya reactivó la unidad. Llamá a ${quien} para confirmarle que puede volver a usar el vehículo y registrá la gestión en la Ficha 360.`,
			type: "action_required" as const,
			status: "pending" as const,
			cobrosTipo: "inmovilizacion_llamar_cliente" as const,
			relatedEntityType: "collection_case" as const,
			relatedEntityId: params.casoCobroId,
			inmovilizacionId: params.inmovilizacionId,
			redirectPage: "cobros_detail" as const,
			createdBy: params.ejecutadoPorUserId,
			createdByRole: params.ejecutadoPorRole ?? ("cobros_supervisor" as const),
			assignedToRole: "cobros" as const,
			assignedTo: params.asesorUserId,
		});
	});
}
