/**
 * D-15: las ubicaciones clave (casa, trabajo) solo se retienen mientras el
 * crédito está en B4. Cada consulta guarda en `gps_consulta_logs.snapshot` lo
 * que se mostró (historial de "Consultas anteriores"), así que esa copia debe
 * salir junto con las filas de `gps_ubicaciones_clave` cuando el crédito deja
 * B4 o se desvincula el GPS.
 *
 * Solo se limpia el snapshot: la fila de auditoría (motivo, usuario, fecha)
 * se conserva, y las consultas de telemetría (`origen = 'telemetria'`) no se
 * tocan. Nunca lanza: es una limpieza accesoria y no debe tumbar el job ni la
 * consulta que la dispara.
 */

import { and, eq, isNotNull, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { gpsConsultaLogs } from "../../db/schema/gps-consulta-logs";

export async function purgarSnapshotsUbicacionesClave(donde?: SQL) {
	try {
		await db
			.update(gpsConsultaLogs)
			.set({ snapshot: null })
			.where(
				and(
					eq(gpsConsultaLogs.origen, "ubicaciones_clave"),
					isNotNull(gpsConsultaLogs.snapshot),
					donde,
				),
			);
	} catch (error) {
		console.error("GPS_SNAPSHOTS_UBICACIONES_PURGA_FALLIDA", {
			message: error instanceof Error ? error.message : String(error),
		});
	}
}
