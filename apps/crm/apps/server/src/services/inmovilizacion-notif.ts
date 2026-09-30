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
// no encuentra nada que cerrar, y un INSERT posterior lo crea igual, ya
// huérfano y `pending` para siempre.
//
// notificarInmovilizacionPendiente cierra la ventana con
// `SELECT ... FOR UPDATE` dentro de una transacción: toma el lock de fila
// de la inmovilización, así que si decidirInmovilizacion/cancelarSolicitud
// (ambos hacen `UPDATE ... WHERE estado = X`) ya tienen la fila lockeada,
// espera a que esa transacción termine — y ve el estado YA actualizado. Un
// SELECT simple (sin FOR UPDATE, como el intento anterior) no logra esto:
// deja de leer una foto vieja mientras el UPDATE concurrente sigue en
// vuelo. Review de Codex, PR #1758.

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { notifications } from "../db/schema/notifications";
import { usuariosDuenosPorSifco } from "../lib/acceso-caso-cobro";
import { toDateStrGT } from "../lib/guatemala-month-window";
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
		// La lista de supervisores no depende del lock — se resuelve antes de
		// abrir la transacción para no retenerla dentro esperando por algo
		// que no la necesita.
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

		await db.transaction(async (tx) => {
			// SELECT ... FOR UPDATE: toma el lock de fila de la inmovilización.
			// Si decidirInmovilizacion/cancelarSolicitud ya la tienen lockeada
			// (su propio UPDATE), esto espera a que terminen — y lee el estado
			// YA actualizado, no una foto vieja. Cierra la ventana de carrera
			// por completo (a diferencia de un SELECT simple). Ver comentario
			// del encabezado del archivo.
			const [inm] = await tx
				.select({ estado: inmovilizacionesUnidad.estado })
				.from(inmovilizacionesUnidad)
				.where(eq(inmovilizacionesUnidad.id, params.inmovilizacionId))
				.for("update")
				.limit(1);
			if (inm?.estado !== "pendiente_aprobacion") return;

			await tx.insert(notifications).values(
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
		// Apagado aprobado: a partir de acá el asesor es quien lo ejecuta (no el
		// supervisor), así que el aviso le dice qué sigue.
		const descripcion =
			params.decision === "aprobada"
				? params.accion === "apagado"
					? "El supervisor aprobó el apagado de la unidad. Pedile a LEGION que lo aplique y, cuando lo confirme, registralo en la Ficha 360 con su confirmación."
					: `El supervisor aprobó la solicitud de ${accionTexto} de unidad.`
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
			descripcion: `Se ejecutó el apagado de la unidad. Llamá a ${quien} y registrá la llamada en la Ficha 360.`,
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

/**
 * Pone cada aviso abierto de "llamar al cliente" en manos de quien lleva HOY
 * el crédito en CARTERA.
 *
 * El aviso nace dirigido al dueño del momento, pero cartera puede reasignar el
 * crédito después (el motor de las 23:59, una reasignación manual, un traslado
 * masivo). Como el acceso a la ficha lo da cartera, el asesor anterior ya no
 * podría cerrar la tarea y el nuevo no se enteraría (review de Codex, P1,
 * PR #1765). Se corre al abrir la inmovilización del caso, después de cada
 * reasignación hecha desde el CRM y en la tanda de alertas de las 08:00.
 *
 * Sin `casoCobroIds` revisa todos los avisos abiertos de este tipo (son pocos:
 * uno por apagado ejecutado sin llamada registrada). Un dueño sin usuario en
 * el CRM deja el aviso donde está (típicamente en quien pidió el apagado, que
 * es quien puede registrar la llamada en ese caso). Best-effort.
 */
export async function reconciliarAvisosLlamarCliente(
	casoCobroIds?: readonly string[],
): Promise<number> {
	let movidos = 0;
	await tryNotify("reconciliarAvisosLlamarCliente", async () => {
		if (casoCobroIds && casoCobroIds.length === 0) return;
		let pendientes = casoCobroIds ? [...casoCobroIds] : undefined;
		// Dos reconciliaciones pueden cruzarse (la de la ficha y la de una
		// reasignación, por ejemplo). Cada movimiento es un compare-and-set sobre
		// el destinatario que se LEYÓ: si otro lo cambió entre medio, el UPDATE no
		// toca nada y ese caso se vuelve a leer —aviso y dueño en cartera— en la
		// vuelta siguiente. Así una lectura vieja nunca devuelve el aviso a un
		// dueño anterior (review de Codex, P1, PR #1765).
		for (let vuelta = 0; vuelta < INTENTOS_RECONCILIACION; vuelta++) {
			const abiertos = await db
				.select({
					id: notifications.id,
					casoCobroId: notifications.relatedEntityId,
					assignedTo: notifications.assignedTo,
					numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				})
				.from(notifications)
				.innerJoin(
					casosCobros,
					eq(casosCobros.id, notifications.relatedEntityId),
				)
				.where(
					and(
						eq(notifications.cobrosTipo, "inmovilizacion_llamar_cliente"),
						eq(notifications.relatedEntityType, "collection_case"),
						inArray(notifications.status, [...ESTADOS_ABIERTOS]),
						pendientes
							? inArray(notifications.relatedEntityId, pendientes)
							: undefined,
					),
				);
			if (abiertos.length === 0) return;

			const duenos = await usuariosDuenosPorSifco(
				abiertos.flatMap((a) =>
					a.numeroCreditoSifco ? [a.numeroCreditoSifco] : [],
				),
			);
			const cruzados = new Set<string>();
			for (const a of abiertos) {
				const dueno = a.numeroCreditoSifco
					? duenos.get(a.numeroCreditoSifco)
					: undefined;
				if (!a.casoCobroId || !dueno || a.assignedTo === dueno) continue;
				const movido = await db
					.update(notifications)
					.set({ assignedTo: dueno, updatedAt: new Date() })
					.where(
						and(
							eq(notifications.id, a.id),
							sql`${notifications.assignedTo} IS NOT DISTINCT FROM ${a.assignedTo}`,
							inArray(notifications.status, [...ESTADOS_ABIERTOS]),
						),
					)
					.returning({ id: notifications.id });
				if (movido.length > 0) movidos++;
				else cruzados.add(a.casoCobroId);
			}
			if (cruzados.size === 0) return;
			pendientes = [...cruzados];
		}
	});
	return movidos;
}

/** Vueltas de relectura cuando otra reconciliación movió el aviso a la vez. */
const INTENTOS_RECONCILIACION = 3;

/**
 * Tipos de aviso que se cierran cuando el apagado se ejecuta o se cancela: el
 * recordatorio de "falta ejecutarlo". El aviso de aprobación es informativo
 * (`aviso`) y no necesita cierre.
 */
export async function resolverRecordatoriosEjecucion(
	inmovilizacionId: string,
): Promise<void> {
	await tryNotify("resolverRecordatoriosEjecucion", () =>
		db
			.update(notifications)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notifications.cobrosTipo, "inmovilizacion_ejecutar_pendiente"),
					eq(notifications.inmovilizacionId, inmovilizacionId),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			),
	);
}

/** Horas que pueden pasar entre la aprobación de un apagado y su ejecución antes de recordarlo. */
const HORAS_PARA_RECORDAR_EJECUCION = 24;

/**
 * Recordatorio al asesor de un apagado APROBADO que lleva más de 24 h sin
 * ejecutarse. Corre en la tanda de las 08:00 GT, así que sale una vez por día
 * mientras siga abierto; la llave de dedup lleva el día, y el run de boot no
 * duplica. Va al dueño en cartera de hoy, con fallback a quien solicitó (mismo
 * criterio que el aviso de llamar al cliente). Best-effort.
 */
export async function recordarApagadosSinEjecutar(
	ahora: Date = new Date(),
): Promise<number> {
	let creados = 0;
	await tryNotify("recordarApagadosSinEjecutar", async () => {
		const limite = new Date(
			ahora.getTime() - HORAS_PARA_RECORDAR_EJECUCION * 60 * 60 * 1000,
		);
		const pendientes = await db
			.select({
				id: inmovilizacionesUnidad.id,
				casoCobroId: inmovilizacionesUnidad.casoCobroId,
				numeroCreditoSifco: inmovilizacionesUnidad.numeroCreditoSifco,
				solicitadoPor: inmovilizacionesUnidad.solicitadoPor,
			})
			.from(inmovilizacionesUnidad)
			.where(
				and(
					eq(inmovilizacionesUnidad.accion, "apagado"),
					eq(inmovilizacionesUnidad.estado, "aprobada"),
					lte(inmovilizacionesUnidad.decididoAt, limite),
				),
			);
		if (pendientes.length === 0) return;

		const duenos = await usuariosDuenosPorSifco(
			pendientes.map((p) => p.numeroCreditoSifco),
		);
		const dia = toDateStrGT(ahora);
		const insertadas = await db
			.insert(notifications)
			.values(
				pendientes.map((p) => ({
					titulo: "Apagado aprobado sin ejecutar",
					descripcion:
						"Hace más de un día se aprobó el apagado de esta unidad y todavía no se registró su ejecución. Coordiná con LEGION y registralo en la Ficha 360, o cancelá la solicitud si ya no aplica.",
					type: "action_required" as const,
					status: "pending" as const,
					cobrosTipo: "inmovilizacion_ejecutar_pendiente" as const,
					cobrosDedupKey: `inmov-ejecutar:${p.id}:${dia}`,
					relatedEntityType: "collection_case" as const,
					relatedEntityId: p.casoCobroId,
					inmovilizacionId: p.id,
					redirectPage: "cobros_detail" as const,
					createdBy: p.solicitadoPor,
					createdByRole: "cobros" as const,
					assignedToRole: "cobros" as const,
					assignedTo: duenos.get(p.numeroCreditoSifco) ?? p.solicitadoPor,
				})),
			)
			.onConflictDoNothing()
			.returning({ id: notifications.id });
		creados = insertadas.length;
	});
	return creados;
}

/**
 * Al ejecutarse un apagado o una reactivación: avisa a los cobros_supervisor que
 * ya se aplicó, con quién lo registró y de qué caso es. Va SOLO a supervisores
 * (el asesor es quien lo hizo, y ya tiene su propio aviso de llamar al
 * cliente); si quien lo registra es un supervisor, no se avisa a sí mismo.
 * Deduplica por inmovilización: un reintento no repite el aviso. Best-effort.
 */
export async function notificarEjecucionASupervisores(params: {
	inmovilizacionId: string;
	casoCobroId: string;
	accion: "apagado" | "reactivacion";
	/** Algo que los supervisores deben saber (p. ej. el crédito ya cambió de bucket). */
	advertencia?: string;
	clienteNombre?: string;
	numeroCreditoSifco?: string;
	ejecutadoPorUserId: string;
	ejecutadoPorRole?: RolNotificacion;
}): Promise<void> {
	await tryNotify("notificarEjecucionASupervisores", async () => {
		const supervisores = (await obtenerSupervisoresCobros()).filter(
			(id) => id !== params.ejecutadoPorUserId,
		);
		if (supervisores.length === 0) return;

		const [quien] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, params.ejecutadoPorUserId))
			.limit(1);
		// "de Fulano (crédito 123)", "del crédito 123" o "de un cliente": la
		// preposición va con el nombre para que lea bien en los tres casos.
		const nombre = params.clienteNombre?.trim();
		const deQuien = nombre
			? `de ${nombre}${params.numeroCreditoSifco ? ` (crédito ${params.numeroCreditoSifco})` : ""}`
			: params.numeroCreditoSifco
				? `del crédito ${params.numeroCreditoSifco}`
				: "de un cliente";
		const esApagado = params.accion === "apagado";

		await db
			.insert(notifications)
			.values(
				supervisores.map((supervisorId) => ({
					titulo: esApagado ? "Apagado ejecutado" : "Reactivación ejecutada",
					descripcion: `${quien?.name ?? "Un asesor"} registró que LEGION ${esApagado ? "apagó" : "reactivó"} la unidad ${deQuien}. Revisá la confirmación en la Ficha 360.${params.advertencia ? ` ${params.advertencia}` : ""}`,
					type: "aviso" as const,
					status: "pending" as const,
					cobrosTipo: esApagado
						? ("inmovilizacion_apagado_ejecutado" as const)
						: ("inmovilizacion_reactivacion_ejecutada" as const),
					cobrosDedupKey: `inmov-${esApagado ? "apagado" : "reactivacion"}:${params.inmovilizacionId}`,
					relatedEntityType: "collection_case" as const,
					relatedEntityId: params.casoCobroId,
					inmovilizacionId: params.inmovilizacionId,
					redirectPage: "cobros_detail" as const,
					createdBy: params.ejecutadoPorUserId,
					createdByRole: params.ejecutadoPorRole ?? ("cobros" as const),
					assignedToRole: "cobros_supervisor" as const,
					assignedTo: supervisorId,
				})),
			)
			.onConflictDoNothing();
	});
}
