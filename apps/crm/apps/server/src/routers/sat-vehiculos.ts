import { z } from "zod";
import {
	iniciarVerificacionVehiculosEnSat,
	obtenerEstadoUltimaVerificacion,
	obtenerReporteCreditosMultiples,
	obtenerUltimaVerificacion,
} from "../jobs/sat-verificacion-vehiculos";
import { auditRecord } from "../lib/audit";
import { adminProcedure } from "../lib/orpc";

export const satVehiculosRouter = {
	/**
	 * Registra y dispara la verificación manual en segundo plano. `forzar` salta
	 * la guarda anti-duplicado al reintentar el mismo día tras un fallo.
	 */
	ejecutarVerificacionSat: adminProcedure
		.input(
			z.object({
				forzar: z.boolean().optional().default(false),
				intento: z.number().int().min(1).optional().default(1),
			}),
		)
		.meta({ audit: { entity: "vehicle", action: "sat_verification_run" } })
		.handler(async ({ input, context }) => {
			const resultado = await iniciarVerificacionVehiculosEnSat({
				usuarioId: context.user.id,
				forzar: input.forzar,
				intento: input.intento,
			});
			auditRecord({
				entity: "vehicle",
				action: "sat_verification_run",
				data: resultado,
				ok:
					resultado.estado === "en_proceso" ||
					resultado.estado === "ok" ||
					resultado.estado === "omitida",
				errorCode: resultado.estado === "error" ? resultado.estado : null,
			});
			return resultado;
		}),

	/** Última corrida con sus alertas (vehículos inactivos o que ya no aparecen). */
	obtenerUltimaVerificacionSat: adminProcedure.handler(async () =>
		obtenerUltimaVerificacion(),
	),

	/** Estado liviano para seguir una ejecución que continúa en segundo plano. */
	obtenerEstadoVerificacionSat: adminProcedure.handler(async () =>
		obtenerEstadoUltimaVerificacion(),
	),

	/** Reporte de vehiculos con mas de un credito operativo vinculado. */
	obtenerConflictosCreditosSat: adminProcedure.handler(async () =>
		obtenerReporteCreditosMultiples(),
	),
};
