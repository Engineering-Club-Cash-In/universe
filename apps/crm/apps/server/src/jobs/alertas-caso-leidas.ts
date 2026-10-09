/**
 * W5 · Job diario: marca como leídas, para cada destinatario, las alertas del
 * caso cuya última repetición tiene más de 30 días (docs/features/cobros-02/
 * 16-workspace-backend.md). Solo toca `alertas_caso_leidas_cobros`: no cambia
 * el estado de las notificaciones, que sigue en la campanita.
 *
 * Es idempotente: una segunda corrida no cambia nada, porque la marca ya tiene
 * `leida_hasta` igual a la última repetición. Una marca manual más nueva no se
 * pisa (la condición del ON CONFLICT).
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { alertasCasoLeidasCobros, casosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import { DIAS_ALERTA_AUTOMATICA_LEIDA } from "../lib/alertas-caso";
import { ESTADOS_ALERTA_ABIERTA } from "../lib/alertas-caso-db";

const TAMANO_LOTE = 500;

/** Devuelve cuántos grupos vencidos revisó (el ON CONFLICT puede omitir alguno). */
export async function marcarAlertasCasoAntiguasLeidas(
	ahora: Date = new Date(),
): Promise<number> {
	const corte = new Date(
		ahora.getTime() - DIAS_ALERTA_AUTOMATICA_LEIDA * 24 * 60 * 60 * 1000,
	);
	const claveSql = sql<string>`COALESCE(${notifications.cobrosTipo}::text, ${notifications.titulo})`;

	const grupos = await db
		.select({
			casoCobroId: notifications.relatedEntityId,
			userId: notifications.assignedTo,
			clave: claveSql,
			ultima: sql<Date>`MAX(${notifications.createdAt})`,
		})
		.from(notifications)
		.innerJoin(user, eq(user.id, notifications.assignedTo))
		.where(
			and(
				eq(notifications.relatedEntityType, "collection_case"),
				isNotNull(notifications.relatedEntityId),
				inArray(notifications.status, [...ESTADOS_ALERTA_ABIERTA]),
				// Solo casos que existen: la marca tiene FK al caso.
				sql`EXISTS (SELECT 1 FROM ${casosCobros} WHERE ${casosCobros.id} = ${notifications.relatedEntityId})`,
			),
		)
		.groupBy(notifications.relatedEntityId, notifications.assignedTo, claveSql)
		.having(sql`MAX(${notifications.createdAt}) < ${corte}`);

	let revisados = 0;
	for (let i = 0; i < grupos.length; i += TAMANO_LOTE) {
		const lote = grupos.slice(i, i + TAMANO_LOTE);
		await db
			.insert(alertasCasoLeidasCobros)
			.values(
				lote.map((g) => ({
					casoCobroId: g.casoCobroId as string,
					userId: g.userId as string,
					clave: g.clave,
					leidaHasta: new Date(g.ultima),
					leidaEn: ahora,
					leidaPor: null,
					origen: "automatico" as const,
				})),
			)
			.onConflictDoUpdate({
				target: [
					alertasCasoLeidasCobros.casoCobroId,
					alertasCasoLeidasCobros.userId,
					alertasCasoLeidasCobros.clave,
				],
				set: {
					leidaHasta: sql`excluded.leida_hasta`,
					leidaEn: sql`excluded.leida_en`,
					leidaPor: null,
					origen: "automatico",
				},
				setWhere: sql`${alertasCasoLeidasCobros.leidaHasta} < excluded.leida_hasta`,
			});
		revisados += lote.length;
	}
	return revisados;
}

/** Envoltorio del scheduler: un fallo se registra y no tumba el proceso. */
export async function correrAlertasCasoAntiguasLeidas(): Promise<void> {
	try {
		const n = await marcarAlertasCasoAntiguasLeidas();
		console.log(`[AlertasCaso] ${n} grupos vencidos revisados (30 días)`);
	} catch (error) {
		console.error("Error en el job de alertas antiguas leídas:", error);
	}
}
