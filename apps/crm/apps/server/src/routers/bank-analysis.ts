import { google } from "@ai-sdk/google";
import { ORPCError } from "@orpc/server";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { creditAnalysis, leads } from "../db/schema/crm";
import {
	BANK_ANALYSIS_PROMPT,
	bankStatementAnalysisSchema,
} from "../lib/bank-analysis-schema";
import { calculateCreditCapacity } from "../lib/financial-math";
import { crmProcedure } from "../lib/orpc";

export const bankAnalysisRouter = {
	analyzeBankStatements: crmProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				files: z
					.array(
						z.object({
							name: z.string(),
							data: z.string(), // base64
							mimeType: z.string().default("application/pdf"),
						}),
					)
					.min(1)
					.max(3),
				annualRate: z.number().default(0.18),
				termMonths: z.number().int().min(12).max(120).default(60),
				maxDebtRatio: z.number().min(0).max(1).default(0.2),
				maxVariableDebtRatio: z.number().min(0).max(1).default(0.3),
			}),
		)
		.handler(async ({ input, context }) => {
			// 1. Verificar que el lead existe y el usuario tiene acceso
			const lead = await db
				.select()
				.from(leads)
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (lead.length === 0) {
				throw new ORPCError("NOT_FOUND", {
					message: "Lead no encontrado",
				});
			}

			if (
				context.userRole === "sales" &&
				lead[0].assignedTo !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para analizar este lead",
				});
			}

			// 2. Construir content parts con los PDFs
			const fileParts = input.files.map((file) => ({
				type: "file" as const,
				data: Buffer.from(file.data, "base64"),
				mediaType: file.mimeType as "application/pdf",
				filename: file.name,
			}));

			// 3. Llamar a Gemini con generateObject
			const { object: analysis } = await generateObject({
				model: google("gemini-3-flash-preview"),
				schema: bankStatementAnalysisSchema,
				messages: [
					{
						role: "system",
						content: BANK_ANALYSIS_PROMPT,
					},
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Analiza los siguientes estados de cuenta bancarios:",
							},
							...fileParts,
						],
					},
				],
			});

			// 4. Calcular capacidad crediticia
			const creditCapacity = calculateCreditCapacity(analysis, {
				annualRate: input.annualRate,
				termMonths: input.termMonths,
				maxDebtRatio: input.maxDebtRatio,
				maxVariableDebtRatio: input.maxVariableDebtRatio,
			});

			// 5. Upsert en tabla creditAnalysis
			const dataForDb = {
				fullAnalysis: JSON.stringify(analysis),
				monthlyFixedIncome:
					analysis.promedio_mensual.promedio_ingresos_fijos.toString(),
				monthlyVariableIncome:
					analysis.promedio_mensual.promedio_ingresos_variables.toString(),
				monthlyFixedExpenses:
					analysis.promedio_mensual.promedio_gastos_fijos.toString(),
				monthlyVariableExpenses:
					analysis.promedio_mensual.promedio_gastos_variables.toString(),
				economicAvailability:
					analysis.promedio_mensual.disponibilidad_economica.toString(),
				minPayment: creditCapacity.minPayment.toString(),
				maxPayment: creditCapacity.maxPayment.toString(),
				adjustedPayment: creditCapacity.adjustedPayment.toString(),
				maxCreditAmount: creditCapacity.maxCreditAmount.toString(),
				analyzedAt: new Date(),
			};

			const existing = await db
				.select()
				.from(creditAnalysis)
				.where(eq(creditAnalysis.leadId, input.leadId))
				.limit(1);

			if (existing.length > 0) {
				await db
					.update(creditAnalysis)
					.set({
						...dataForDb,
						updatedAt: new Date(),
					})
					.where(eq(creditAnalysis.leadId, input.leadId));
			} else {
				await db.insert(creditAnalysis).values({
					leadId: input.leadId,
					...dataForDb,
					createdBy: context.userId,
				});
			}

			// 6. Retornar resultados
			return {
				analysis,
				creditCapacity,
			};
		}),
};
