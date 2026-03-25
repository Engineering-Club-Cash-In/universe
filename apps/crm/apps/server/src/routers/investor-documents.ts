import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorActivityLog } from "../db/schema";
import {
	crmCobrosOrInvestmentsProcedure,
	investmentManagerProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";

export const investorDocumentsRouter = {
	getInvestorRendimiento: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				email: z.string().email(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.getInvestorRendimiento(
				input.email,
			);
			return result;
		}),

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

			// Solo manager/admin pueden hacer visible el documento al crearlo
			const canSetVisible = PERMISSIONS.canValidateInvestmentFunds(
				context.userRole,
			);
			const visible = canSetVisible ? input.visible : false;

			const result = await carteraBackClient.createInvestorDocument({
				file: blob,
				inversionista_id: input.inversionistaId,
				nombre: input.nombre,
				descripcion: input.descripcion,
				visible,
				created_by: context.session.user.name ?? context.session.user.email,
			});

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_created",
				details: {
					nombre: input.nombre,
					descripcion: input.descripcion,
					visible,
					mimeType: input.fileMimeType,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Solo manager/admin pueden cambiar visibilidad
	toggleInvestorDocumentVisibility: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				documentoId: z.number().int().positive(),
				visible: z.boolean(),
				documentoNombre: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.toggleInvestorDocumentVisibility(
				input.documentoId,
				input.visible,
			);

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_visibility_toggled",
				details: {
					documentoId: input.documentoId,
					documentoNombre: input.documentoNombre,
					visible: input.visible,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	deleteInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				documentoId: z.number().int().positive(),
				documentoNombre: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.deleteInvestorDocument(
				input.documentoId,
			);

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_deleted",
				details: {
					documentoId: input.documentoId,
					documentoNombre: input.documentoNombre,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Solo manager/admin pueden ver el historial de actividad
	getInvestorActivityLog: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const logs = await db
				.select()
				.from(investorActivityLog)
				.where(eq(investorActivityLog.inversionistaId, input.inversionistaId))
				.orderBy(desc(investorActivityLog.createdAt))
				.limit(100);

			return logs;
		}),
};
