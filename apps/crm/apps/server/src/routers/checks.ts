import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { creditChecks, opportunities, quotations } from "../db/schema";
import { crmProcedure } from "../lib/orpc";
import { ROLES } from "../lib/roles";

export const checksRouter = {
	// Crear nuevo cheque/transferencia
	createCheck: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid().optional(),
				quotationId: z.string().uuid().optional(),
				checkDate: z.string().or(z.date()),
				issuer: z.string().min(1),
				issuerBank: z.string().min(1),
				beneficiary: z.string().min(1),
				accountNumber: z.string().optional(),
				transferType: z.string().default("TRANSFERENCIA"),
				accountType: z.string().default("MONETARIA"),
				beneficiaryBank: z.string().optional(),
				concept: z.string().min(1),
				currency: z.string().default("GTQ"),
				amount: z.number().positive(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Validar que el usuario sea sales o admin
			const userRole = context.userRole;
			if (userRole !== ROLES.SALES && userRole !== ROLES.ADMIN) {
				throw new Error("Solo usuarios de ventas pueden registrar cheques");
			}

			// Validar que se proporcione al menos una referencia
			if (!input.opportunityId && !input.quotationId) {
				throw new Error(
					"Debe asociar el cheque a una oportunidad o cotización",
				);
			}

			// Crear cheque
			const [check] = await db
				.insert(creditChecks)
				.values({
					opportunityId: input.opportunityId,
					quotationId: input.quotationId,
					checkDate:
						typeof input.checkDate === "string"
							? new Date(input.checkDate)
							: input.checkDate,
					issuer: input.issuer,
					issuerBank: input.issuerBank,
					beneficiary: input.beneficiary,
					accountNumber: input.accountNumber,
					transferType: input.transferType,
					accountType: input.accountType,
					beneficiaryBank: input.beneficiaryBank,
					concept: input.concept,
					currency: input.currency,
					amount: input.amount.toString(),
					createdBy: context.userId,
				})
				.returning();

			return check;
		}),

	// Obtener cheques por oportunidad
	getChecksByOpportunity: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const checks = await db
				.select()
				.from(creditChecks)
				.where(eq(creditChecks.opportunityId, input.opportunityId))
				.orderBy(desc(creditChecks.checkDate));

			return checks;
		}),

	// Obtener cheques por cotización
	getChecksByQuotation: crmProcedure
		.input(z.object({ quotationId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const checks = await db
				.select()
				.from(creditChecks)
				.where(eq(creditChecks.quotationId, input.quotationId))
				.orderBy(desc(creditChecks.checkDate));

			return checks;
		}),

	// Actualizar cheque
	updateCheck: crmProcedure
		.input(
			z.object({
				checkId: z.string().uuid(),
				checkDate: z.string().or(z.date()).optional(),
				issuer: z.string().min(1).optional(),
				issuerBank: z.string().min(1).optional(),
				beneficiary: z.string().min(1).optional(),
				accountNumber: z.string().optional(),
				transferType: z.string().optional(),
				accountType: z.string().optional(),
				beneficiaryBank: z.string().optional(),
				concept: z.string().min(1).optional(),
				currency: z.string().optional(),
				amount: z.number().positive().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar que existe
			const [existing] = await db
				.select()
				.from(creditChecks)
				.where(eq(creditChecks.id, input.checkId))
				.limit(1);

			if (!existing) {
				throw new Error("Cheque no encontrado");
			}

			// Validar permisos
			const userRole = context.userRole;
			if (userRole !== ROLES.ADMIN && existing.createdBy !== context.userId) {
				throw new Error("No tienes permiso para editar este cheque");
			}

			// Actualizar
			const [updated] = await db
				.update(creditChecks)
				.set({
					checkDate: input.checkDate
						? typeof input.checkDate === "string"
							? new Date(input.checkDate)
							: input.checkDate
						: undefined,
					issuer: input.issuer,
					issuerBank: input.issuerBank,
					beneficiary: input.beneficiary,
					accountNumber: input.accountNumber,
					transferType: input.transferType,
					accountType: input.accountType,
					beneficiaryBank: input.beneficiaryBank,
					concept: input.concept,
					currency: input.currency,
					amount: input.amount?.toString(),
					updatedAt: new Date(),
				})
				.where(eq(creditChecks.id, input.checkId))
				.returning();

			return updated;
		}),

	// Eliminar cheque
	deleteCheck: crmProcedure
		.input(z.object({ checkId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar que existe
			const [existing] = await db
				.select()
				.from(creditChecks)
				.where(eq(creditChecks.id, input.checkId))
				.limit(1);

			if (!existing) {
				throw new Error("Cheque no encontrado");
			}

			// Validar permisos
			const userRole = context.userRole;
			if (userRole !== ROLES.ADMIN && existing.createdBy !== context.userId) {
				throw new Error("No tienes permiso para eliminar este cheque");
			}

			await db.delete(creditChecks).where(eq(creditChecks.id, input.checkId));

			return { success: true };
		}),

	// Obtener resumen de cheques para una oportunidad (totales)
	getChecksSummary: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const checks = await db
				.select()
				.from(creditChecks)
				.where(eq(creditChecks.opportunityId, input.opportunityId));

			const total = checks.reduce(
				(sum, check) => sum + Number(check.amount),
				0,
			);
			const count = checks.length;

			return {
				total,
				count,
				checks,
			};
		}),
};
