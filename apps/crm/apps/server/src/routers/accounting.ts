import { z } from "zod";
import { crmProcedure } from "../lib/orpc";
import { carteraBackClient } from "../services/cartera-back-client";

export const accountingRouter = {
	getResumenGlobalInversionistas: crmProcedure
		.input(
			z
				.object({
					inversionistaId: z.union([z.string(), z.number()]).optional(),
					estado: z
						.enum(["pending", "uploaded", "liquidated", "all"])
						.optional()
						.default("pending"),
					mes: z.number().int().min(1).max(12).optional(),
					anio: z.number().int().min(2000).max(2100).optional(),
				})
				.refine(
					(value) =>
						!["liquidated", "all"].includes(value.estado) ||
						(value.mes !== undefined && value.anio !== undefined),
					{
						message:
							"Los parámetros 'mes' y 'anio' son obligatorios cuando estado es 'liquidated' o 'all'.",
						path: ["mes"],
					},
				),
		)
		.output(z.array(z.any()))
		.handler(async ({ input }) => {
			try {
				const data = await carteraBackClient.getResumenGlobalInversionistas(
					input,
				);
				const filtered = data.filter(
					(item) => Number(item.total_a_recibir_con_reinversion) >= 0,
				);
				return filtered;
			} catch (error) {
				console.error("[ORPC] getResumenGlobalInversionistas error:", error);
				throw error;
			}
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

	liquidateInversionista: crmProcedure
		.input(
			z.object({
				inversionista_id: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.liquidateInversionista(
				input.inversionista_id,
			);
			return result;
		}),
};
