import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { analystProcedure, crmOnlyProcedure, crmProcedure } from "../lib/orpc";
import {
	DocumentIntegrityError,
	getDocumentIntegrityAttemptStatus,
	getDocumentIntegrityStatuses,
	getDocumentIntegrityValidationGroup,
	getLatestReusableDocumentIntegrityRun,
	listDocumentIntegrityValidations,
	resetDocumentIntegrityAttempts,
	validateExistingOpportunityDocuments,
	validateUploadedBankStatements,
} from "../services/document-integrity";

function translateDomainError(error: unknown): never {
	if (error instanceof DocumentIntegrityError) {
		switch (error.code) {
			case "NOT_FOUND":
				throw new ORPCError("NOT_FOUND", { message: error.message });
			case "BAD_REQUEST":
				throw new ORPCError("BAD_REQUEST", { message: error.message });
			case "FORBIDDEN":
				throw new ORPCError("FORBIDDEN", { message: error.message });
			case "TOO_MANY_REQUESTS":
				throw new ORPCError("TOO_MANY_REQUESTS", { message: error.message });
		}
	}
	throw error;
}

const uploadedFileSchema = z.object({
	name: z.string().trim().min(1).max(255),
	key: z.string().trim().min(1),
	mimeType: z.string().default("application/pdf"),
});

export const documentIntegrityProcedures = {
	resetDocumentIntegrityAttempts: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			if (
				context.userRole !== "admin" &&
				context.userRole !== "sales_supervisor" &&
				context.userRole !== "analyst"
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para reiniciar validaciones documentales",
				});
			}
			try {
				return await resetDocumentIntegrityAttempts({
					opportunityId: input.opportunityId,
					userId: context.userId,
				});
			} catch (error) {
				translateDomainError(error);
			}
		}),

	getDocumentIntegrityAttemptStatus: crmOnlyProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			try {
				return await getDocumentIntegrityAttemptStatus({
					opportunityId: input.opportunityId,
					salesUserId:
						context.userRole === "sales" ? context.userId : undefined,
				});
			} catch (error) {
				translateDomainError(error);
			}
		}),

	getLatestReusableDocumentIntegrityRun: crmOnlyProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			try {
				return await getLatestReusableDocumentIntegrityRun({
					opportunityId: input.opportunityId,
					salesUserId:
						context.userRole === "sales" ? context.userId : undefined,
				});
			} catch (error) {
				translateDomainError(error);
			}
		}),

	getDocumentIntegrityStatus: crmOnlyProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			try {
				return await getDocumentIntegrityStatuses({
					opportunityId: input.opportunityId,
					salesUserId:
						context.userRole === "sales" ? context.userId : undefined,
				});
			} catch (error) {
				translateDomainError(error);
			}
		}),

	validarDocumentosSubidos: crmProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				opportunityId: z.string().uuid(),
				files: z.array(uploadedFileSchema).min(1).max(9),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const rows = await validateUploadedBankStatements({
					...input,
					userId: context.userId,
					userRole: context.userRole,
				});
				return rows.map((row) => ({
					file: row.file,
					error: row.error,
					validation: row.validation
						? {
								id: row.validation.id,
								result: row.validation.autoResult,
								reason: row.validation.autoReason,
								validatedAt: row.validation.validatedAt,
							}
						: null,
				}));
			} catch (error) {
				translateDomainError(error);
			}
		}),

	validarDocumentosExistentes: analystProcedure
		.input(
			z.object({
				opportunityDocumentIds: z
					.array(z.string().uuid())
					.min(1)
					.max(9)
					.refine((ids) => new Set(ids).size === ids.length, {
						message: "No se puede validar dos veces el mismo documento",
					}),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const results = await validateExistingOpportunityDocuments({
					documentIds: input.opportunityDocumentIds,
					userId: context.userId,
				});
				return results.map(({ errorCode: _errorCode, ...result }) => result);
			} catch (error) {
				translateDomainError(error);
			}
		}),

	listDocumentIntegrityValidations: analystProcedure
		.input(
			z
				.object({
					search: z.string().trim().max(100).optional(),
					opportunityId: z.string().uuid().optional(),
					requiresReviewOnly: z.boolean().default(true),
					limit: z.number().int().min(1).max(100).default(20),
					offset: z.number().int().min(0).default(0),
				})
				.optional(),
		)
		.handler(async ({ input }) =>
			listDocumentIntegrityValidations({
				search: input?.search,
				opportunityId: input?.opportunityId,
				requiresReviewOnly: input?.requiresReviewOnly ?? true,
				limit: input?.limit ?? 20,
				offset: input?.offset ?? 0,
			}),
		),

	getDocumentIntegrityValidationGroup: analystProcedure
		.input(
			z
				.object({
					opportunityId: z.string().uuid().optional(),
					validationId: z.string().uuid().optional(),
					cycleStartAfterAttemptNumber: z
						.number()
						.int()
						.nonnegative()
						.optional(),
				})
				.refine((input) => input.opportunityId || input.validationId, {
					message: "Indica una oportunidad o validación",
				}),
		)
		.handler(async ({ input }) => {
			try {
				return await getDocumentIntegrityValidationGroup(input);
			} catch (error) {
				translateDomainError(error);
			}
		}),
};
