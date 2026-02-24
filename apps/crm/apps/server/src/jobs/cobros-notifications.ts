/**
 * Job periódico de notificaciones de cobros
 * - Seguimientos vencidos (proximoContacto pasó sin nuevo contacto)
 * - Casos sin contacto por 3+ días
 *
 * Optimizado para batch queries (3 queries fijas por función en vez de N+1)
 */

import { and, eq, gt, inArray, isNotNull, lt, max, sql } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";

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
