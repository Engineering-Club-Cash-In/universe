import { z } from "zod";
import { crmProcedure } from "../lib/orpc";
import { carteraBackClient } from "../services/cartera-back-client";

export const accountingRouter = {
	getResumenGlobalInversionistas: crmProcedure.handler(async () => {
		return await carteraBackClient.getResumenGlobalInversionistas()
	}),

	createBoleta: crmProcedure
		.input(
			z.object({
				inversionista_id: z.number().int().positive(),
				boleta_url: z.string(),
				monto_boleta: z.string().optional(),
				notas: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const boleta = await carteraBackClient.createBoleta({
				inversionista_id: input.inversionista_id,
				boleta_url: input.boleta_url,
				monto_boleta: input.monto_boleta,
				notas: input.notas,
				subido_por: 1,
			});
			return boleta;
		}),
};
