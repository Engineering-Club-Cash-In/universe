import { ORPCError } from "@orpc/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	clientFormTokens,
	creditApplications,
	financialStatements,
} from "../db/schema/client-forms";
import { leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { crmProcedure, publicProcedure } from "../lib/orpc";

// Fields that are decimal/integer in the DB and must not receive empty strings
const DECIMAL_FIELDS = new Set([
	"valorEstimado",
	"montoSolicitado",
	"sueldo",
	"egresos",
	"efectivo",
	"cuentasCobrarAmigos",
	"cuentasCobrarOtros",
	"documentosCobrar",
	"bienesInmueblesValor",
	"vehiculosValor",
	"maquinaria",
	"muebles",
	"menaje",
	"cuentasPagarAmigos",
	"cuentasPagarOtros",
	"letrasPagar",
	"sueldos",
	"bonificaciones",
	"arrendamientos",
	"gastosPersonales",
	"alquileres",
	"amortizacionVivienda",
	"deudasPersonales",
]);

const INTEGER_FIELDS = new Set([
	"edad",
	"dependientes",
	"bienesInmueblesCantidad",
	"vehiculosCantidad",
]);

function sanitizeFormData(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (DECIMAL_FIELDS.has(key)) {
			if (value === "" || value === null || value === undefined) {
				sanitized[key] = null;
			} else {
				const num = Number(value);
				sanitized[key] = Number.isNaN(num) ? null : String(num);
			}
		} else if (INTEGER_FIELDS.has(key)) {
			if (value === "" || value === null || value === undefined) {
				sanitized[key] = null;
			} else {
				const num = Number(value);
				sanitized[key] = Number.isNaN(num) ? null : Math.trunc(num);
			}
		} else {
			sanitized[key] = value;
		}
	}
	return sanitized;
}

export const clientFormsRouter = {
	// Protected: Generate a token for an opportunity
	generateFormToken: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			// Check opportunity exists
			const [opp] = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opp) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Create token with 7-day expiry
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);

			const [tokenRow] = await db
				.insert(clientFormTokens)
				.values({
					opportunityId: input.opportunityId,
					expiresAt,
				})
				.returning();

			const url = `${process.env.FRONT_URL}/formulario/${tokenRow.token}`;
			return { token: tokenRow.token, url };
		}),

	// Public: Validate token and return data for pre-fill
	validateFormToken: publicProcedure
		.input(z.object({ token: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [tokenRow] = await db
				.select()
				.from(clientFormTokens)
				.where(
					and(
						eq(clientFormTokens.token, input.token),
						gt(clientFormTokens.expiresAt, new Date()),
					),
				)
				.limit(1);

			if (!tokenRow) {
				throw new ORPCError("NOT_FOUND", {
					message: "El enlace es inválido o ha expirado",
				});
			}

			if (tokenRow.used) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este formulario ya fue completado",
				});
			}

			// Get opportunity + lead data for pre-fill
			const [opp] = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, tokenRow.opportunityId))
				.limit(1);

			let lead = null;
			if (opp?.leadId) {
				const [leadRow] = await db
					.select()
					.from(leads)
					.where(eq(leads.id, opp.leadId))
					.limit(1);
				lead = leadRow ?? null;
			}

			let vehicle = null;
			if (opp?.vehicleId) {
				const [vehicleRow] = await db
					.select()
					.from(vehicles)
					.where(eq(vehicles.id, opp.vehicleId))
					.limit(1);
				vehicle = vehicleRow ?? null;
			}

			// Check if forms already exist (partial submission)
			const [existingCredit] = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, tokenRow.opportunityId))
				.limit(1);

			const [existingFinancial] = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, tokenRow.opportunityId))
				.limit(1);

			return {
				opportunityId: tokenRow.opportunityId,
				lead,
				vehicle,
				creditApplicationExists: !!existingCredit,
				financialStatementExists: !!existingFinancial,
			};
		}),

	// Public: Submit credit application
	submitCreditApplication: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			// Validate token
			const [tokenRow] = await db
				.select()
				.from(clientFormTokens)
				.where(
					and(
						eq(clientFormTokens.token, input.token),
						gt(clientFormTokens.expiresAt, new Date()),
					),
				)
				.limit(1);

			if (!tokenRow) {
				throw new ORPCError("NOT_FOUND", {
					message: "El enlace es inválido o ha expirado",
				});
			}

			if (tokenRow.used) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este formulario ya fue completado",
				});
			}

			// Upsert credit application
			const values = {
				opportunityId: tokenRow.opportunityId,
				...sanitizeFormData(input.data),
				updatedAt: new Date(),
			};

			const [existing] = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, tokenRow.opportunityId))
				.limit(1);

			if (existing) {
				await db
					.update(creditApplications)
					.set(values)
					.where(eq(creditApplications.id, existing.id));
			} else {
				await db.insert(creditApplications).values(values);
			}

			return { success: true };
		}),

	// Public: Submit financial statement
	submitFinancialStatement: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			// Validate token
			const [tokenRow] = await db
				.select()
				.from(clientFormTokens)
				.where(
					and(
						eq(clientFormTokens.token, input.token),
						gt(clientFormTokens.expiresAt, new Date()),
					),
				)
				.limit(1);

			if (!tokenRow) {
				throw new ORPCError("NOT_FOUND", {
					message: "El enlace es inválido o ha expirado",
				});
			}

			if (tokenRow.used) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este formulario ya fue completado",
				});
			}

			// Upsert financial statement
			const values = {
				opportunityId: tokenRow.opportunityId,
				...sanitizeFormData(input.data),
				updatedAt: new Date(),
			};

			const [existing] = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, tokenRow.opportunityId))
				.limit(1);

			if (existing) {
				await db
					.update(financialStatements)
					.set(values)
					.where(eq(financialStatements.id, existing.id));
			} else {
				await db.insert(financialStatements).values(values);
			}

			// Mark token as used (both forms now submitted)
			await db
				.update(clientFormTokens)
				.set({ used: true })
				.where(eq(clientFormTokens.id, tokenRow.id));

			return { success: true };
		}),

	// Protected: Get form data for viewing in CRM
	getClientFormData: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [creditApp] = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, input.opportunityId))
				.limit(1);

			const [financialStmt] = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, input.opportunityId))
				.limit(1);

			return {
				creditApplication: creditApp ?? null,
				financialStatement: financialStmt ?? null,
			};
		}),

	// Protected: Check if token exists for opportunity
	getFormTokenByOpportunity: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [tokenRow] = await db
				.select()
				.from(clientFormTokens)
				.where(eq(clientFormTokens.opportunityId, input.opportunityId))
				.limit(1);

			if (!tokenRow) return null;

			return {
				token: tokenRow.token,
				url: `${process.env.FRONT_URL}/formulario/${tokenRow.token}`,
				expiresAt: tokenRow.expiresAt,
				used: tokenRow.used,
			};
		}),
};
