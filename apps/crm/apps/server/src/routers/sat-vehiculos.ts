import { z } from "zod";
import {
	obtenerUltimaVerificacion,
	verificarVehiculosEnSat,
} from "../jobs/sat-verificacion-vehiculos";
import { protectedProcedure } from "../lib/orpc";

export const satVehiculosRouter = {
	/**
	 * Dispara la verificación a mano. `forzar` salta la guarda anti-duplicado,
	 * necesario cuando se quiere reintentar el mismo día tras un fallo.
	 */
	ejecutarVerificacionSat: protectedProcedure
		.input(
			z.object({
				forzar: z.boolean().optional().default(false),
				intento: z.number().int().min(1).optional().default(1),
			}),
		)
		.handler(async ({ input }) =>
			verificarVehiculosEnSat({
				origen: "manual",
				forzar: input.forzar,
				intento: input.intento,
			}),
		),

	/** Última corrida con sus alertas (vehículos inactivos o que ya no aparecen). */
	obtenerUltimaVerificacionSat: protectedProcedure.handler(async () =>
		obtenerUltimaVerificacion(),
	),
};
