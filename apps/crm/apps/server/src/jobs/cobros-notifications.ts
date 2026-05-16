/**
 * Job periódico de notificaciones de cobros
 * - Seguimientos vencidos (proximoContacto pasó sin nuevo contacto)
 * - Casos sin contacto por 3+ días
 *
 * Optimizado para batch queries (3 queries fijas por función en vez de N+1)
 * procesarSeguimientosRecurrentes: 5 queries fijas (era 1+4N)
 */

import { and, eq, gt, inArray, isNotNull, lt, max, sql } from "drizzle-orm";

import { db } from "../db";
import { casosCobros, contactosCobros, seguimientosProgramados } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import { toDateStrGT } from "../lib/guatemala-month-window";

export async function checkSeguimientosVencidos() {
	const now = new Date();

	// Query 1: Casos con proximoContacto vencido
	const casosVencidos = await db
		.select({
			id: casosCobros.id,
			responsable: casosCobros.responsableCobros,
			proximoContacto: casosCobros.proximoContacto,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
		})
		.from(casosCobros)
		.where(
			and(
				eq(casosCobros.activo, true),
				isNotNull(casosCobros.proximoContacto),
				lt(casosCobros.proximoContacto, now),
			),
		);

	if (casosVencidos.length === 0) {
		console.log("[CobrosNotifications] Seguimientos vencidos: 0 encontrados");
		return;
	}

	const casoIds = casosVencidos.map((c) => c.id);

	// Query 2: Batch dedup — IDs que ya tienen notificación "Seguimiento vencido" en últimas 24h
	const yaNotificados = await db
		.select({ relatedEntityId: notifications.relatedEntityId })
		.from(notifications)
		.where(
			and(
				inArray(notifications.relatedEntityId, casoIds),
				eq(notifications.relatedEntityType, "collection_case"),
				eq(notifications.titulo, "Seguimiento vencido"),
				gt(notifications.createdAt, sql`now() - interval '24 hours'`),
			),
		);

	const notificadosSet = new Set(yaNotificados.map((n) => n.relatedEntityId));

	const nuevasNotificaciones = casosVencidos
		.filter((caso) => !notificadosSet.has(caso.id))
		.map((caso) => ({
			titulo: "Seguimiento vencido" as const,
			descripcion: `El seguimiento del caso ${caso.numeroCreditoSifco || caso.id.slice(0, 8)} venció el ${caso.proximoContacto?.toLocaleDateString("es-GT")}`,
			type: "reminder" as const,
			status: "pending" as const,
			createdBy: caso.responsable,
			createdByRole: "cobros" as const,
			assignedToRole: "cobros" as const,
			assignedTo: caso.responsable,
			relatedEntityType: "collection_case" as const,
			relatedEntityId: caso.id,
			redirectPage: "cobros_detail" as const,
		}));

	// Query 3: Batch insert
	if (nuevasNotificaciones.length > 0) {
		await db.insert(notifications).values(nuevasNotificaciones);
	}

	console.log(
		`[CobrosNotifications] Seguimientos vencidos: ${casosVencidos.length} encontrados, ${nuevasNotificaciones.length} notificados`,
	);
}

export async function checkCasosSinContacto(diasLimite = 3) {
	const limite = new Date();
	limite.setDate(limite.getDate() - diasLimite);

	// Query 1: Casos activos cuyo último contacto es anterior al límite
	// Subquery con MAX(fecha_contacto) agrupado por caso_cobro_id
	const ultimoContactoPorCaso = db
		.select({
			casoCobroId: contactosCobros.casoCobroId,
			ultimaFecha: max(contactosCobros.fechaContacto).as("ultima_fecha"),
		})
		.from(contactosCobros)
		.groupBy(contactosCobros.casoCobroId)
		.as("ultimo_contacto");

	const casosSinContacto = await db
		.select({
			id: casosCobros.id,
			responsable: casosCobros.responsableCobros,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			ultimaFecha: ultimoContactoPorCaso.ultimaFecha,
		})
		.from(casosCobros)
		.innerJoin(
			ultimoContactoPorCaso,
			eq(casosCobros.id, ultimoContactoPorCaso.casoCobroId),
		)
		.where(
			and(
				eq(casosCobros.activo, true),
				lt(ultimoContactoPorCaso.ultimaFecha, limite),
			),
		);

	if (casosSinContacto.length === 0) {
		console.log(
			`[CobrosNotifications] Casos sin contacto (>${diasLimite} días): 0 encontrados`,
		);
		return;
	}

	const casoIds = casosSinContacto.map((c) => c.id);

	// Query 2: Batch dedup — IDs que ya tienen notificación en últimas 24h
	const yaNotificados = await db
		.select({ relatedEntityId: notifications.relatedEntityId })
		.from(notifications)
		.where(
			and(
				inArray(notifications.relatedEntityId, casoIds),
				eq(notifications.relatedEntityType, "collection_case"),
				eq(notifications.titulo, "Caso sin contacto reciente"),
				gt(notifications.createdAt, sql`now() - interval '24 hours'`),
			),
		);

	const notificadosSet = new Set(yaNotificados.map((n) => n.relatedEntityId));

	const nuevasNotificaciones = casosSinContacto
		.filter((caso) => !notificadosSet.has(caso.id))
		.map((caso) => {
			const dias = Math.floor(
				(Date.now() - caso.ultimaFecha!.getTime()) / (1000 * 60 * 60 * 24),
			);
			return {
				titulo: "Caso sin contacto reciente" as const,
				descripcion: `El caso ${caso.numeroCreditoSifco || caso.id.slice(0, 8)} lleva ${dias} días sin contacto`,
				type: "reminder" as const,
				status: "pending" as const,
				createdBy: caso.responsable,
				createdByRole: "cobros" as const,
				assignedToRole: "cobros" as const,
				assignedTo: caso.responsable,
				relatedEntityType: "collection_case" as const,
				relatedEntityId: caso.id,
				redirectPage: "cobros_detail" as const,
			};
		});

	// Query 3: Batch insert
	if (nuevasNotificaciones.length > 0) {
		await db.insert(notifications).values(nuevasNotificaciones);
	}

	console.log(
		`[CobrosNotifications] Casos sin contacto (>${diasLimite} días): ${casosSinContacto.length} encontrados, ${nuevasNotificaciones.length} notificados`,
	);
}

// Two-component advisory lock key: namespace=1 (cobros jobs), key=1 (procesarSeguimientosRecurrentes)
const SEGUIMIENTOS_LOCK = [1, 1] as const;

export async function procesarSeguimientosRecurrentes() {
	const client = await db.$client.connect();
	try {
		const { rows } = await client.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[...SEGUIMIENTOS_LOCK],
		);
		if (!rows[0].acquired) {
			console.log("[SeguimientosRecurrentes] Already running (distributed lock held), skipping");
			return;
		}
		await _procesarSeguimientosRecurrentes(client);
	} finally {
		await client.query("SELECT pg_advisory_unlock($1, $2)", [...SEGUIMIENTOS_LOCK]);
		client.release();
	}
}

// Minimal interface so we don't need to import pg types directly.
interface RawClient {
	query<T extends object>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

async function _procesarSeguimientosRecurrentes(client: RawClient) {
	const now = new Date();
	const hoyStr = toDateStrGT(now);
	const hoyMs = new Date(`${hoyStr}T00:00:00`).getTime();

	// Query 1: seguimientos activos + caso data en un solo JOIN (elimina per-row SELECT caso)
	const seguimientos = await db
		.select({
			id: seguimientosProgramados.id,
			casoCobroId: seguimientosProgramados.casoCobroId,
			fechaInicio: seguimientosProgramados.fechaInicio,
			fechaFin: seguimientosProgramados.fechaFin,
			intervaloDias: seguimientosProgramados.intervaloDias,
			ocurrenciasRealizadas: seguimientosProgramados.ocurrenciasRealizadas,
			ocurrenciasMaximas: seguimientosProgramados.ocurrenciasMaximas,
			metodoContacto: seguimientosProgramados.metodoContacto,
			agenteId: seguimientosProgramados.agenteId,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			responsableCobros: casosCobros.responsableCobros,
		})
		.from(seguimientosProgramados)
		.innerJoin(casosCobros, eq(seguimientosProgramados.casoCobroId, casosCobros.id))
		.where(eq(seguimientosProgramados.activo, true));

	if (seguimientos.length === 0) {
		console.log("[CobrosNotifications] procesarSeguimientosRecurrentes: 0 seguimientos activos, nada que procesar");
		return;
	}

	console.log(`[CobrosNotifications] procesarSeguimientosRecurrentes: ${seguimientos.length} seguimientos activos encontrados`);

	// Categorize in JS — no DB roundtrip per row
	const toDeactivateIds: string[] = [];
	type SegRow = typeof seguimientos[number];
	type ClaimRow = SegRow & { oldOcurrencias: number; newOcurrencias: number; proximaFecha: Date };
	const claimRows: ClaimRow[] = [];

	for (const seg of seguimientos) {
		// Datos corruptos — check constraint protege rows nuevos; esto cubre legacy.
		if (seg.intervaloDias <= 0) { toDeactivateIds.push(seg.id); continue; }
		if (seg.fechaFin && toDateStrGT(seg.fechaFin) < hoyStr) { toDeactivateIds.push(seg.id); continue; }
		if (seg.ocurrenciasMaximas != null && seg.ocurrenciasRealizadas >= seg.ocurrenciasMaximas) {
			toDeactivateIds.push(seg.id); continue;
		}

		// Días transcurridos en zona GT — evita catch-up N-veces si el scheduler estuvo caído.
		const diasTranscurridos = Math.floor(
			(hoyMs - new Date(`${toDateStrGT(seg.fechaInicio)}T00:00:00`).getTime()) / 86_400_000,
		);
		if (diasTranscurridos < 0) continue;

		// Largest k where fechaInicio + k*intervaloDias <= today
		const ocurrenciasDebidas = Math.floor(diasTranscurridos / seg.intervaloDias);
		if (ocurrenciasDebidas >= seg.ocurrenciasRealizadas) {
			const newOcurrencias = ocurrenciasDebidas + 1;
			// Aritmética en ms — Guatemala no tiene DST.
			const proximaFecha = new Date(
				seg.fechaInicio.getTime() + seg.intervaloDias * newOcurrencias * 86_400_000,
			);
			claimRows.push({ ...seg, oldOcurrencias: seg.ocurrenciasRealizadas, newOcurrencias, proximaFecha });
		}
	}

	// Query 2: batch deactivate (1 query vs N)
	if (toDeactivateIds.length > 0) {
		await db.update(seguimientosProgramados)
			.set({ activo: false, updatedAt: new Date() })
			.where(inArray(seguimientosProgramados.id, toDeactivateIds));
	}

	if (claimRows.length === 0) {
		console.log(`[SeguimientosRecurrentes] ${toDeactivateIds.length} desactivados, 0 a procesar`);
		return;
	}

	// Query 3: batch CAS — UPDATE FROM VALUES con guard por ocurrencias_realizadas.
	// Rows que ya fueron tomados por un runner concurrente no aparecen en RETURNING.
	const casParams: unknown[] = [];
	const casPh = claimRows.map((r, i) => {
		const b = i * 3;
		casParams.push(r.id, r.oldOcurrencias, r.newOcurrencias);
		return `($${b + 1}::uuid, $${b + 2}::int, $${b + 3}::int)`;
	}).join(", ");

	const casResult = await client.query<{ id: string }>(
		`UPDATE seguimientos_programados AS sp
		 SET ocurrencias_realizadas = v.new_occ, updated_at = NOW()
		 FROM (VALUES ${casPh}) AS v(id, old_occ, new_occ)
		 WHERE sp.id = v.id AND sp.ocurrencias_realizadas = v.old_occ
		 RETURNING sp.id`,
		casParams,
	);

	const claimedIds = new Set(casResult.rows.map((r) => r.id));
	const claimed = claimRows.filter((r) => claimedIds.has(r.id));

	if (claimed.length === 0) {
		console.log("[SeguimientosRecurrentes] 0 claims ganados (runner concurrente los tomó)");
		return;
	}

	// Query 4: batch update casosCobros via UPDATE FROM VALUES (1 query vs N)
	// Deduplicar por casoCobroId: si hay múltiples seguimientos para el mismo caso,
	// PostgreSQL UPDATE FROM con IDs duplicados en VALUES elige fila de forma no determinista.
	// Quedarse con la proximaFecha más próxima para cada caso.
	const casoMap = new Map<string, ClaimRow>();
	for (const r of claimed) {
		const prev = casoMap.get(r.casoCobroId);
		if (!prev || r.proximaFecha < prev.proximaFecha) casoMap.set(r.casoCobroId, r);
	}
	const uniqueCasoRows = Array.from(casoMap.values());

	const casoParams: unknown[] = [];
	const casoPh = uniqueCasoRows.map((r, i) => {
		const b = i * 3;
		casoParams.push(r.casoCobroId, r.proximaFecha.toISOString(), r.metodoContacto);
		return `($${b + 1}::uuid, $${b + 2}::timestamptz, $${b + 3}::text)`;
	}).join(", ");

	await client.query(
		`UPDATE casos_cobros AS cc
		 SET proximo_contacto = v.proximo_contacto,
		     metodo_contacto_proximo = v.metodo::metodo_contacto,
		     updated_at = NOW()
		 FROM (VALUES ${casoPh}) AS v(id, proximo_contacto, metodo)
		 WHERE cc.id = v.id`,
		casoParams,
	);

	// Query 5: batch insert notifications (1 query vs N)
	await db.insert(notifications).values(
		claimed.map((r) => ({
			titulo: "Nuevo seguimiento programado" as const,
			descripcion: `Se ha programado automáticamente un contacto vía ${r.metodoContacto} para el crédito ${r.numeroCreditoSifco ?? r.casoCobroId.slice(0, 8)}`,
			type: "reminder" as const,
			status: "pending" as const,
			createdBy: r.agenteId,
			createdByRole: "cobros" as const,
			assignedToRole: "cobros" as const,
			assignedTo: r.responsableCobros,
			relatedEntityType: "collection_case" as const,
			relatedEntityId: r.casoCobroId,
			redirectPage: "cobros_detail" as const,
		})),
	);

	for (const r of claimed) {
		console.log(`[CobrosNotifications] ✅ Seguimiento disparado para caso ${r.casoCobroId} | próximo contacto: ${toDateStrGT(r.proximaFecha)}`);
	}

	console.log(
		`[SeguimientosRecurrentes] ${toDeactivateIds.length} desactivados, ${claimed.length}/${claimRows.length} procesados`,
	);
}
