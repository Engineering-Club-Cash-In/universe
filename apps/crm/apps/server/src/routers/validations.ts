import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { analystProcedure } from "../lib/orpc";
import {
	ejecutarValidaciones,
	getValidaciones,
	OportunidadNoEncontradaError,
} from "../services/opportunity-validations";

/**
 * Validaciones de RENAP y Buró (Infornet) para oportunidades cuyo origen
 * NO es el bot de WhatsApp. Las oportunidades del bot quedan exentas.
 *
 * Ambos procedimientos exigen rol de análisis: la respuesta incluye score,
 * nivel de riesgo y motivos de rechazo del buró (antecedentes penales,
 * morosidad, PEP), que no deben quedar al alcance de cualquier sesión.
 */
export const validationsRouter = {
	ejecutarValidacionesRenapBuro: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			return ejecutarValidaciones({
				opportunityId: input.opportunityId,
				userId: context.userId,
			});
		}),

	getValidacionesOportunidad: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			try {
				return await getValidaciones({ opportunityId: input.opportunityId });
			} catch (error) {
				if (error instanceof OportunidadNoEncontradaError) {
					throw new ORPCError("NOT_FOUND", { message: error.message });
				}
				throw error;
			}
		}),
};
