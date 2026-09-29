/**
 * CB-035 — Tarea de llamada al supervisor en los primeros 3 días de ingreso a B3.
 *
 * Corre dentro del job de las 8:00 GT de alertas de cobros (checkCobrosAlertas),
 * con los eventos de bucket que ese job ya trajo de cartera-back — no hace una
 * segunda pasada paginada por el historial. La regla vive en lib/b3-llamada.ts.
 *
 *   1. Crear   → cada SUBIDA a B3 reciente genera una tarea `b3_llamada_supervisor`
 *                para TODOS los cobros_supervisor, con `fecha_vencimiento` a 3
 *                días hábiles del ingreso.
 *   2. Revisar → las tareas abiertas se cierran si ya hay una llamada en el caso
 *                (`resolved`) o si el crédito cambió de bucket (`dismissed`); las
 *                que vencieron sin llamada generan la alerta `b3_llamada_vencida`
 *                a supervisores + asesor dueño. La tarea sigue abierta hasta que
 *                se llame.
 *
 * La dedup es por episodio (`uq_notifications_cobros_dedup`, llave con el
 * `historial_id` del evento) con `onConflictDoNothing`, no un SELECT previo: dos
 * corridas simultáneas, o el solape de la ventana de creación, no duplican nada.
 * Nunca lanza al caller: el fallo de este paso no debe tumbar cliente_subido ni
 * sin_contacto_3d.
 */

import { and, eq, inArray, isNotNull, max } from "drizzle-orm";
import { db } from "../db";
import { contactosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	dedupKeyTareaB3,
	dedupKeyVencidaB3,
	esIngresoB3,
	estadoTareaB3,
	fechaVencimientoB3,
	historialIdDeDedupKeyB3,
} from "../lib/b3-llamada";
import type { CarteraBucketHistorialRow } from "../types/cartera-back";
import {
	filasNotificacionCobros,
	mapearCasosPorSifco,
} from "./cobros-notif-helpers";

const LOG_PREFIX = "[CobrosB3Llamada]";

const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

// Cuántos días calendario GT hacia atrás se buscan ingresos a B3 sin tarea. La
// dedup hace inocua la repetición, y una ventana mayor a la de cliente_subido
// (ayer+hoy) hace que una mañana sin job (caída, deploy) no pierda tareas.
const VENTANA_CREACION_DIAS = 7;

const GT_TZ = "America/Guatemala";
function gtDateKey(d: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: GT_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);
}

/** "dd/mm/yyyy" en GT, para los textos que lee el supervisor. */
function fechaLegibleGT(d: Date): string {
	const [y, m, day] = gtDateKey(d).split("-");
	return `${day}/${m}/${y}`;
}

export interface B3LlamadaResumen {
	/** Casos con tarea nueva creada en esta corrida. */
	tareas: number;
	/** Casos con alerta de vencimiento nueva. */
	vencidas: number;
	/** Tareas cerradas (llamada hecha u obsoletas). */
	cerradas: number;
}

const RESUMEN_VACIO: B3LlamadaResumen = { tareas: 0, vencidas: 0, cerradas: 0 };

export async function procesarTareasB3(params: {
	eventos: CarteraBucketHistorialRow[];
	ahora: Date;
	/** `asesor_id (cartera) → user.id (CRM)`. */
	mapaAsesor: Map<number, string>;
	supervisores: string[];
	usuarioSistema: string;
}): Promise<B3LlamadaResumen> {
	try {
		const porHistorialId = new Map<number, CarteraBucketHistorialRow>();
		const ultimoPorCredito = new Map<number, number>();
		for (const e of params.eventos) {
			porHistorialId.set(e.historial_id, e);
			const prev = ultimoPorCredito.get(e.credito_id);
			if (prev === undefined || e.historial_id > prev) {
				ultimoPorCredito.set(e.credito_id, e.historial_id);
			}
		}

		// Crear antes de revisar: si la corrida llega tarde (caída del job) y una
		// tarea nace ya vencida, se alerta en esta misma pasada.
		const tareas = await crearTareas({ ...params, ultimoPorCredito });
		const { vencidas, cerradas } = await revisarTareasAbiertas({
			...params,
			porHistorialId,
			ultimoPorCredito,
		});

		console.log(
			`${LOG_PREFIX} tareas nuevas: ${tareas} · vencidas: ${vencidas} · cerradas: ${cerradas}`,
		);
		return { tareas, vencidas, cerradas };
	} catch (err) {
		console.error(`${LOG_PREFIX} Error:`, err);
		return RESUMEN_VACIO;
	}
}

/** Paso 1: una tarea por cada ingreso a B3 reciente que sigue siendo el último evento. */
async function crearTareas(params: {
	eventos: CarteraBucketHistorialRow[];
	ahora: Date;
	supervisores: string[];
	usuarioSistema: string;
	ultimoPorCredito: Map<number, number>;
}): Promise<number> {
	if (params.supervisores.length === 0) {
		console.warn(`${LOG_PREFIX} Sin cobros_supervisor; no hay a quién asignar`);
		return 0;
	}

	const desdeKey = gtDateKey(
		new Date(params.ahora.getTime() - VENTANA_CREACION_DIAS * 86_400_000),
	);
	// Comparación lexicográfica de "YYYY-MM-DD": equivale a la de fechas.
	const ingresos = params.eventos.filter(
		(e) =>
			esIngresoB3(e) &&
			gtDateKey(new Date(e.fecha)) >= desdeKey &&
			// Si el crédito ya tuvo otro evento después, la tarea nacería obsoleta.
			params.ultimoPorCredito.get(e.credito_id) === e.historial_id,
	);
	if (ingresos.length === 0) return 0;

	const casoPorSifco = await mapearCasosPorSifco(
		ingresos.map((e) => e.numero_credito_sifco),
	);

	const filas = ingresos.flatMap((e) => {
		const casoId = casoPorSifco.get(e.numero_credito_sifco);
		if (!casoId) return []; // sin caso activo no hay dónde colgar la tarea
		const vence = fechaVencimientoB3(new Date(e.fecha));
		return filasNotificacionCobros({
			casoId,
			cobrosTipo: "b3_llamada_supervisor",
			type: "action_required",
			titulo: "Llamar al cliente: ingresó a B3",
			descripcion: `El crédito ${e.numero_credito_sifco} (${e.cliente}) ingresó a ${e.bucket_nuevo_nombre ?? "B3"}. Llamá al cliente antes del ${fechaLegibleGT(vence)} para intervenir; si no se cumple, se genera una alerta.`,
			asesorUserId: null, // la tarea es del supervisor
			supervisores: params.supervisores,
			usuarioSistema: params.usuarioSistema,
			dedupKey: dedupKeyTareaB3(e.historial_id),
			fechaVencimiento: vence,
		});
	});
	if (filas.length === 0) return 0;

	const insertadas = await db
		.insert(notifications)
		.values(filas)
		.onConflictDoNothing()
		.returning({ casoId: notifications.relatedEntityId });
	return new Set(insertadas.map((r) => r.casoId)).size;
}

/** Paso 2: cerrar las cumplidas/obsoletas y alertar las vencidas. */
async function revisarTareasAbiertas(params: {
	ahora: Date;
	mapaAsesor: Map<number, string>;
	supervisores: string[];
	usuarioSistema: string;
	porHistorialId: Map<number, CarteraBucketHistorialRow>;
	ultimoPorCredito: Map<number, number>;
}): Promise<{ vencidas: number; cerradas: number }> {
	const abiertas = await db
		.select({
			id: notifications.id,
			casoId: notifications.relatedEntityId,
			dedupKey: notifications.cobrosDedupKey,
			fechaVencimiento: notifications.fechaVencimiento,
		})
		.from(notifications)
		.where(
			and(
				eq(notifications.cobrosTipo, "b3_llamada_supervisor"),
				// Calza con el predicado del índice parcial uq_notifications_cobros_dedup.
				isNotNull(notifications.cobrosDedupKey),
				inArray(notifications.status, [...ESTADOS_ABIERTOS]),
			),
		);
	if (abiertas.length === 0) return { vencidas: 0, cerradas: 0 };

	const casoIds = [
		...new Set(abiertas.map((t) => t.casoId).filter((v): v is string => !!v)),
	];
	const ultimaLlamada = await ultimaLlamadaPorCaso(casoIds);

	const aResolver: string[] = [];
	const aDescartar: string[] = [];
	// Una alerta por EPISODIO aunque haya una tarea por supervisor.
	const vencidasPorKey = new Map<
		string,
		{ casoId: string; evento: CarteraBucketHistorialRow; dedupKey: string }
	>();

	for (const t of abiertas) {
		if (!t.casoId || !t.fechaVencimiento) {
			// Fila sin caso o sin plazo (inserción manual): no se puede juzgar; se
			// retira para que no quede abierta para siempre.
			console.warn(
				`${LOG_PREFIX} Tarea ${t.id} sin caso o vencimiento; se descarta`,
			);
			aDescartar.push(t.id);
			continue;
		}
		const historialId = historialIdDeDedupKeyB3(t.dedupKey);
		const evento =
			historialId !== null ? params.porHistorialId.get(historialId) : undefined;
		const estado = estadoTareaB3({
			ahora: params.ahora,
			fechaVencimiento: t.fechaVencimiento,
			fechaIngreso: evento ? new Date(evento.fecha) : null,
			ingresoEsUltimoEvento: evento
				? params.ultimoPorCredito.get(evento.credito_id) === evento.historial_id
				: null,
			ultimaLlamada: ultimaLlamada.get(t.casoId) ?? null,
		});
		if (estado === "cumplida") aResolver.push(t.id);
		else if (estado === "obsoleta") aDescartar.push(t.id);
		else if (estado === "vencida" && evento && t.dedupKey) {
			vencidasPorKey.set(t.dedupKey, {
				casoId: t.casoId,
				evento,
				dedupKey: t.dedupKey,
			});
		}
	}

	const ahora = new Date();
	if (aResolver.length > 0) {
		await db
			.update(notifications)
			.set({ status: "resolved", resolvedAt: ahora, updatedAt: ahora })
			.where(
				and(
					inArray(notifications.id, aResolver),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			);
	}
	if (aDescartar.length > 0) {
		await db
			.update(notifications)
			.set({ status: "dismissed", updatedAt: ahora })
			.where(
				and(
					inArray(notifications.id, aDescartar),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			);
	}

	const filasVencidas = [...vencidasPorKey.values()].flatMap((v) => {
		const e = v.evento;
		const credito = `${e.numero_credito_sifco} (${e.cliente})`;
		const asesor = e.asesor || "Sin asesor asignado";
		return filasNotificacionCobros({
			casoId: v.casoId,
			cobrosTipo: "b3_llamada_vencida",
			titulo: "Tarea vencida: llamada a cliente en B3",
			descripcion: `Venció el plazo de 3 días hábiles para llamar al crédito ${credito} en ${e.bucket_nuevo_nombre ?? "B3"} y no hay llamada registrada.`,
			descripcionSupervisor: `Venció la tarea de llamada del crédito ${credito} (asesor ${asesor}) en ${e.bucket_nuevo_nombre ?? "B3"}: no hay llamada registrada dentro de los 3 días hábiles.`,
			asesorUserId:
				e.asesor_id != null
					? (params.mapaAsesor.get(e.asesor_id) ?? null)
					: null,
			supervisores: params.supervisores,
			usuarioSistema: params.usuarioSistema,
			dedupKey: dedupKeyVencidaB3(v.dedupKey),
		});
	});
	let vencidas = 0;
	if (filasVencidas.length > 0) {
		const insertadas = await db
			.insert(notifications)
			.values(filasVencidas)
			.onConflictDoNothing()
			.returning({ casoId: notifications.relatedEntityId });
		vencidas = new Set(insertadas.map((r) => r.casoId)).size;
	}

	return { vencidas, cerradas: aResolver.length + aDescartar.length };
}

/** max(fecha_contacto) de las `llamada` por caso. */
async function ultimaLlamadaPorCaso(
	casoIds: string[],
): Promise<Map<string, Date>> {
	if (casoIds.length === 0) return new Map();
	const rows = await db
		.select({
			casoId: contactosCobros.casoCobroId,
			ultima: max(contactosCobros.fechaContacto),
		})
		.from(contactosCobros)
		.where(
			and(
				inArray(contactosCobros.casoCobroId, casoIds),
				eq(contactosCobros.metodoContacto, "llamada"),
			),
		)
		.groupBy(contactosCobros.casoCobroId);
	const map = new Map<string, Date>();
	for (const r of rows) if (r.ultima) map.set(r.casoId, r.ultima);
	return map;
}

/**
 * Cierra al instante las tareas b3_llamada_supervisor abiertas de un caso, al
 * registrarse una llamada (createContactoCobros). Sin esto la tarea seguiría
 * pendiente hasta la corrida de las 8:00 GT del día siguiente. Best-effort:
 * un fallo acá no debe romper el guardado de la gestión, y el job reconcilia
 * igual (mismo criterio que resolverAvisoLlamarCliente de CB-041).
 */
export async function cerrarTareasB3DelCaso(casoId: string): Promise<void> {
	try {
		const ahora = new Date();
		await db
			.update(notifications)
			.set({ status: "resolved", resolvedAt: ahora, updatedAt: ahora })
			.where(
				and(
					eq(notifications.relatedEntityId, casoId),
					eq(notifications.cobrosTipo, "b3_llamada_supervisor"),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
				),
			);
	} catch (error) {
		console.warn(
			`${LOG_PREFIX} No se pudo cerrar la tarea B3 del caso ${casoId} (best-effort):`,
			error instanceof Error ? error.message : error,
		);
	}
}
