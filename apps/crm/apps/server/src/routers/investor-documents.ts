import { z } from "zod";
import { crmCobrosOrInvestmentsProcedure } from "../lib/orpc";
import { carteraBackClient } from "../services/cartera-back-client";

export const investorDocumentsRouter = {
	getInvestorDocumentsAdmin: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.getInvestorDocumentsAdmin(
				input.inversionistaId,
			);
			return result;
		}),

	createInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				nombre: z.string().min(1),
				descripcion: z.string().optional(),
				visible: z.boolean().optional(),
				fileBase64: z.string().min(1),
				fileMimeType: z.string().min(1),
			}),
		)
		.handler(async ({ input, context }) => {
			const buffer = Buffer.from(input.fileBase64, "base64");
			const blob = new Blob([buffer], { type: input.fileMimeType });

			const result = await carteraBackClient.createInvestorDocument({
				file: blob,
				inversionista_id: input.inversionistaId,
				nombre: input.nombre,
				descripcion: input.descripcion,
				visible: input.visible,
				created_by: context.session.user.name ?? context.session.user.email,
			});
			return result;
		}),

	toggleInvestorDocumentVisibility: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				documentoId: z.number().int().positive(),
				visible: z.boolean(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.toggleInvestorDocumentVisibility(
				input.documentoId,
				input.visible,
			);
			return result;
		}),

	deleteInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				documentoId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.deleteInvestorDocument(
				input.documentoId,
			);
			return result;
		}),
};
