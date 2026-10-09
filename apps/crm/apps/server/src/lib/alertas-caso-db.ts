/**
 * W5 · Consultas de las alertas del caso que lee y marca el Workspace. La
 * agrupación y el «leída» viven en `alertas-caso.ts` (puro); aquí solo se lee y
 * se escribe la base.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { alertasCasoLeidasCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import type { FilaAlertaCaso, MarcaAlertaLeida } from "./alertas-caso";

/**
 * Estados ABIERTOS de una alerta. Las `resolved` y `dismissed` ya se cerraron
 * (CB-033 pasa a `resolved` los convenios decididos) y no se listan.
 */
export const ESTADOS_ALERTA_ABIERTA = [
	"pending",
	"read",
	"in_progress",
] as const;

/**
 * Filas abiertas de notificaciones de cobros del caso, las más nuevas primero.
 * Sin `limite` trae todas: marcar un grupo necesita la repetición más reciente
 * de TODAS, no solo de las que se muestran.
 */
export async function cargarFilasAbiertasCaso(
	casoCobroId: string,
	limite?: number,
): Promise<FilaAlertaCaso[]> {
	const base = db
		.select({
			id: notifications.id,
			titulo: notifications.titulo,
			descripcion: notifications.descripcion,
			cobrosTipo: notifications.cobrosTipo,
			status: notifications.status,
			createdAt: notifications.createdAt,
			assignedTo: notifications.assignedTo,
		})
		.from(notifications)
		.where(
			and(
				eq(notifications.relatedEntityId, casoCobroId),
				eq(notifications.relatedEntityType, "collection_case"),
				inArray(notifications.status, [...ESTADOS_ALERTA_ABIERTA]),
			),
		)
		.orderBy(desc(notifications.createdAt));
	return limite ? base.limit(limite) : base;
}

/** Marcas de lectura del usuario en el caso, por clave de grupo. */
export async function cargarMarcasAlertas(
	casoCobroId: string,
	userId: string,
): Promise<Map<string, MarcaAlertaLeida>> {
	const filas = await db
		.select({
			clave: alertasCasoLeidasCobros.clave,
			leidaHasta: alertasCasoLeidasCobros.leidaHasta,
			leidaEn: alertasCasoLeidasCobros.leidaEn,
			leidaPor: alertasCasoLeidasCobros.leidaPor,
			nombreLeidaPor: user.name,
			origen: alertasCasoLeidasCobros.origen,
		})
		.from(alertasCasoLeidasCobros)
		.leftJoin(user, eq(user.id, alertasCasoLeidasCobros.leidaPor))
		.where(
			and(
				eq(alertasCasoLeidasCobros.casoCobroId, casoCobroId),
				eq(alertasCasoLeidasCobros.userId, userId),
			),
		);
	return new Map(
		filas.map((f) => [
			f.clave,
			{
				leidaHasta: f.leidaHasta,
				leidaEn: f.leidaEn,
				leidaPor: f.leidaPor,
				nombreLeidaPor: f.nombreLeidaPor ?? null,
				origen: f.origen as MarcaAlertaLeida["origen"],
			},
		]),
	);
}

/**
 * Marca el grupo como leído para el usuario. Si ya había una marca, la
 * reemplaza: la nueva `leidaHasta` nunca es menor que la anterior, porque sale
 * de las filas que existen ahora.
 */
export async function marcarGrupoLeido(params: {
	casoCobroId: string;
	userId: string;
	clave: string;
	leidaHasta: Date;
	leidaPor: string;
}): Promise<void> {
	await db
		.insert(alertasCasoLeidasCobros)
		.values({
			casoCobroId: params.casoCobroId,
			userId: params.userId,
			clave: params.clave,
			leidaHasta: params.leidaHasta,
			leidaEn: new Date(),
			leidaPor: params.leidaPor,
			origen: "manual",
		})
		.onConflictDoUpdate({
			target: [
				alertasCasoLeidasCobros.casoCobroId,
				alertasCasoLeidasCobros.userId,
				alertasCasoLeidasCobros.clave,
			],
			set: {
				leidaHasta: params.leidaHasta,
				leidaEn: new Date(),
				leidaPor: params.leidaPor,
				origen: "manual",
			},
		});
}
