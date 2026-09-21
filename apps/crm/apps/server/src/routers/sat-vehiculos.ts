import { z } from "zod";
import {
	obtenerUltimaVerificacion,
	verificarVehiculosEnSat,
} from "../jobs/sat-verificacion-vehiculos";
import { auditRecord } from "../lib/audit";
import { adminProcedure } from "../lib/orpc";

export const satVehiculosRouter = {
	/**
	 * Dispara la verificación a mano. `forzar` salta la guarda anti-duplicado,
	 * necesario cuando se quiere reintentar el mismo día tras un fallo.
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
			const resultado = await verificarVehiculosEnSat({
				usuarioId: context.user.id,
				forzar: input.forzar,
				intento: input.intento,
			});
			auditRecord({
				entity: "vehicle",
				action: "sat_verification_run",
				data: resultado,
				ok: resultado.estado === "ok" || resultado.estado === "omitida",
				errorCode: resultado.estado === "ok" ? null : resultado.estado,
			});
			return resultado;
		}),

	/** Última corrida con sus alertas (vehículos inactivos o que ya no aparecen). */
	obtenerUltimaVerificacionSat: adminProcedure.handler(async () =>
		obtenerUltimaVerificacion(),
	),
};
