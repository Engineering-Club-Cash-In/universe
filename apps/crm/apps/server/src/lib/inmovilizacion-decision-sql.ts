import { sql } from "drizzle-orm";
import { inmovilizacionesUnidad as t } from "../db/schema/inmovilizacion-unidad";

/**
 * Fecha y responsable de la «decisión» de un apagado o una reactivación, para
 * la bitácora del supervisor y el filtro por fechas del historial.
 *
 * Aprobar y rechazar guardan `decidido_at` y `decidido_por`. CANCELAR no: las dos
 * rutas de cancelación (`cancelarSolicitud` y el cierre por precondición que
 * falla al ejecutar) solo cambian `estado` y dejan quién y cuándo en
 * `inmovilizaciones_unidad_eventos`. Para una solicitud cancelada se toma el
 * último evento de cancelación; así una pendiente cancelada días después no se
 * fecha con su solicitud, ni una aprobada y cancelada después se atribuye a
 * quien la aprobó.
 */

const eventoCancelacion = (columna: "created_at" | "usuario_id") =>
	sql`(SELECT e.${sql.raw(columna)} FROM inmovilizaciones_unidad_eventos e
		WHERE e.inmovilizacion_id = ${t.id} AND e.estado_nuevo = 'cancelada'
		ORDER BY e.created_at DESC LIMIT 1)`;

/** Cuándo se decidió (o canceló); si no hay decisión, cuándo se solicitó. */
export const fechaDecisionInmovilizacion = sql`CASE
	WHEN ${t.estado} = 'cancelada'
		THEN coalesce(${eventoCancelacion("created_at")}, ${t.decididoAt}, ${t.solicitadoAt})
	ELSE coalesce(${t.decididoAt}, ${t.solicitadoAt})
END`;

/** Quién decidió (o canceló); null si todavía no hay decisión. */
export const decisorInmovilizacionId = sql<string | null>`CASE
	WHEN ${t.estado} = 'cancelada'
		THEN coalesce(${eventoCancelacion("usuario_id")}, ${t.decididoPor})
	ELSE ${t.decididoPor}
END`;
