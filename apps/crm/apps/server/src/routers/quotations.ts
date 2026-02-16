import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { quotations, vehicles } from "../db/schema";
import { crmProcedure } from "../lib/orpc";
import { ROLES } from "../lib/roles";

/**
 * Calcula la cuota mensual usando la fórmula PMT de Excel
 * PMT = P * (r * (1 + r)^n) / ((1 + r)^n - 1)
 * Incluye IVA del 12% en la tasa de interés
 */
function calculateMonthlyPayment(
	principal: number,
	monthlyRate: number,
	termMonths: number,
	insuranceCost: number,
	gpsCost: number,
): number {
	// La tasa incluye IVA (12%)
	const r = (monthlyRate / 100) * 1.12;

	if (r === 0) return principal / termMonths;

	const factor = (1 + r) ** termMonths;
	const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);

	// Agregar seguro y GPS a la cuota mensual
	return baseMonthlyPayment + insuranceCost + gpsCost;
}

/**
 * Genera la tabla de amortización
 */
export interface AmortizationRow {
	period: number;
	initialBalance: number;
	interestPlusVAT: number;
	principal: number;
	finalBalance: number;
}

function generateAmortizationTable(
	totalFinanced: number,
	monthlyRate: number,
	termMonths: number,
	_insuranceCost: number,
	_gpsCost: number,
): AmortizationRow[] {
	const table: AmortizationRow[] = [];
	let balance = totalFinanced;
	const r = monthlyRate / 100;
	const VAT = 0.12; // 12% IVA

	// Calcular la cuota base (sin seguro ni GPS)
	const rWithVAT = r * (1 + VAT);
	const factor = (1 + rWithVAT) ** termMonths;
	const baseMonthlyPayment =
		(totalFinanced * (rWithVAT * factor)) / (factor - 1);

	// Período 0 (inicial)
	const initialInterest = balance * r;
	const initialInterestWithVAT = initialInterest * (1 + VAT);

	table.push({
		period: 0,
		initialBalance: balance,
		interestPlusVAT: initialInterestWithVAT,
		principal: 0,
		finalBalance: balance,
	});

	// Períodos 1 a termMonths
	for (let i = 1; i <= termMonths; i++) {
		const interest = balance * r;
		const interestWithVAT = interest * (1 + VAT);
		const principalPayment = baseMonthlyPayment - interestWithVAT;
		const newBalance = balance - principalPayment;

		table.push({
			period: i,
			initialBalance: balance,
			interestPlusVAT: interestWithVAT,
			principal: principalPayment,
			finalBalance: newBalance > 0 ? newBalance : 0,
		});

		balance = newBalance;
	}

	return table;
}

export const quotationsRouter = {
	// Crear nueva cotización
	createQuotation: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid().optional(),
				vehicleId: z.string().uuid().optional(),
				vehicleBrand: z.string().optional(),
				vehicleLine: z.string().optional(),
				vehicleModel: z.string().optional(),
				vehicleType: z
					.enum([
						"particular",
						"uber",
						"pickup",
						"nuevo",
						"panel",
						"camion",
						"microbus",
						"microbus_20",
						"microbus_35",
						"microbus_36plus",
					])
					.default("particular"),
				vehicleValue: z.number().positive(),
				insuredAmount: z.number().positive(),
				downPayment: z.number().positive(),
				termMonths: z.number().int().positive(),
				interestRate: z.number().positive(),
				insuranceCost: z.number().default(0),
				gpsCost: z.number().default(0),
				transferCost: z.number().default(0),
				adminCost: z.number().default(0),
				membershipCost: z.number().default(0),
				// Gastos adicionales para detalle de crédito
				freelanceCost: z.number().default(0),
				freelancePercentage: z.number().optional(),
				royalty: z.number().default(0),
				royaltyPercentage: z.number().default(4.0),
				inspectionCost: z.number().default(0),
				finesCost: z.number().default(0),
				keyCopyCost: z.number().default(0),
				keyCopyDiffCost: z.number().default(0),
				circulationTaxCost: z.number().default(0),
				mobileGuaranteeCost: z.number().default(0),
				licensePlatesCost: z.number().default(0),
				leasingContractCost: z.number().default(0),
				collectionAuthCost: z.number().default(0),
				legalCost: z.number().default(0),
				// Gastos específicos de Autocompras
				appointmentCost: z.number().default(0),
				addressVerificationCost: z.number().default(0),
				// Gastos extra para detalle de crédito (descuentos iniciales)
				extraGpsCost: z.number().default(0),
				extraInsuranceCost: z.number().default(0),
				extraMembershipCost: z.number().default(0),
				extraAdminCost: z.number().default(600),
				interestCost: z.number().default(0),
				vehicleTransferCost: z.number().default(0),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Validar que el usuario sea sales o admin
			const userRole = context.userRole;
			if (userRole !== ROLES.SALES && userRole !== ROLES.ADMIN) {
				throw new ORPCError("FORBIDDEN", {
					message: "Solo usuarios de ventas pueden crear cotizaciones",
				});
			}

			// Si se proporciona vehicleId, obtener datos del vehículo
			let vehicleData = {
				brand: input.vehicleBrand,
				line: input.vehicleLine,
				model: input.vehicleModel,
			};

			if (input.vehicleId) {
				const [vehicle] = await db
					.select()
					.from(vehicles)
					.where(eq(vehicles.id, input.vehicleId))
					.limit(1);

				if (vehicle) {
					vehicleData = {
						brand: vehicle.make,
						line: vehicle.model,
						model: vehicle.year.toString(),
					};
				}
			}

			// Calcular valores
			const downPaymentPercentage =
				(input.downPayment / input.vehicleValue) * 100;
			const amountToFinance = input.vehicleValue - input.downPayment;

			// Calcular royalty si no se proporcionó: 4% del total financiado
			const royalty =
				input.royalty > 0
					? input.royalty
					: (input.vehicleValue - input.downPayment) *
						(input.royaltyPercentage / 100);

			// Costos que se financian (NO incluyen seguro ni GPS)
			// La membresía ya está incluida en adminCost, no se debe agregar de nuevo
			const financedCosts = input.transferCost + input.adminCost;

			const totalFinanced = amountToFinance + financedCosts;

			// La cuota mensual incluye seguro y GPS aparte
			const monthlyPayment = calculateMonthlyPayment(
				totalFinanced,
				input.interestRate,
				input.termMonths,
				input.insuranceCost,
				input.gpsCost,
			);

			// Crear cotización
			const [quotation] = await db
				.insert(quotations)
				.values({
					opportunityId: input.opportunityId,
					vehicleId: input.vehicleId,
					salesUserId: context.userId,
					vehicleBrand: vehicleData.brand || null,
					vehicleLine: vehicleData.line || null,
					vehicleModel: vehicleData.model || null,
					vehicleType: input.vehicleType,
					vehicleValue: input.vehicleValue.toString(),
					insuredAmount: input.insuredAmount.toString(),
					downPayment: input.downPayment.toString(),
					downPaymentPercentage: downPaymentPercentage.toFixed(2),
					termMonths: input.termMonths,
					interestRate: input.interestRate.toString(),
					insuranceCost: input.insuranceCost.toString(),
					gpsCost: input.gpsCost.toString(),
					transferCost: input.transferCost.toString(),
					adminCost: input.adminCost.toString(),
					membershipCost: input.membershipCost.toString(),
					// Gastos adicionales para detalle de crédito
					freelanceCost: input.freelanceCost.toString(),
					freelancePercentage: input.freelancePercentage?.toString() ?? null,
					royalty: royalty.toFixed(2),
					royaltyPercentage: input.royaltyPercentage.toString(),
					inspectionCost: input.inspectionCost.toString(),
					finesCost: input.finesCost.toString(),
					keyCopyCost: input.keyCopyCost.toString(),
					keyCopyDiffCost: input.keyCopyDiffCost.toString(),
					circulationTaxCost: input.circulationTaxCost.toString(),
					mobileGuaranteeCost: input.mobileGuaranteeCost.toString(),
					licensePlatesCost: input.licensePlatesCost.toString(),
					leasingContractCost: input.leasingContractCost.toString(),
					collectionAuthCost: input.collectionAuthCost.toString(),
					legalCost: input.legalCost.toString(),
					// Gastos específicos de Autocompras
					appointmentCost: input.appointmentCost.toString(),
					addressVerificationCost: input.addressVerificationCost.toString(),
					// Gastos extra para detalle de crédito (descuentos iniciales)
					extraGpsCost: input.extraGpsCost.toString(),
					extraInsuranceCost: input.extraInsuranceCost.toString(),
					extraMembershipCost: input.extraMembershipCost.toString(),
					extraAdminCost: input.extraAdminCost.toString(),
					interestCost: input.interestCost.toString(),
					vehicleTransferCost: input.vehicleTransferCost.toString(),
					amountToFinance: amountToFinance.toString(),
					totalFinanced: totalFinanced.toString(),
					monthlyPayment: monthlyPayment.toFixed(2),
					notes: input.notes,
				})
				.returning();

			return quotation;
		}),

	// Obtener cotizaciones del usuario
	getQuotations: crmProcedure.handler(async ({ context }) => {
		const userRole = context.userRole;

		// Admin ve todas, sales solo las suyas
		if (userRole === ROLES.ADMIN) {
			const result = await db
				.select()
				.from(quotations)
				.orderBy(desc(quotations.createdAt));
			return result;
		}

		const result = await db
			.select()
			.from(quotations)
			.where(eq(quotations.salesUserId, context.userId))
			.orderBy(desc(quotations.createdAt));

		return result;
	}),

	// Obtener cotización por ID con tabla de amortización
	getQuotationById: crmProcedure
		.input(z.object({ quotationId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [quotation] = await db
				.select()
				.from(quotations)
				.where(eq(quotations.id, input.quotationId))
				.limit(1);

			if (!quotation) {
				throw new ORPCError("NOT_FOUND", {
					message: "Cotización no encontrada",
				});
			}

			// Validar acceso
			const userRole = context.userRole;
			if (
				userRole !== ROLES.ADMIN &&
				quotation.salesUserId !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para ver esta cotización",
				});
			}

			// Generar tabla de amortización
			const amortizationTable = generateAmortizationTable(
				Number(quotation.totalFinanced),
				Number(quotation.interestRate),
				quotation.termMonths,
				Number(quotation.insuranceCost),
				Number(quotation.gpsCost),
			);

			return {
				...quotation,
				amortizationTable,
			};
		}),

	// Actualizar cotización
	updateQuotation: crmProcedure
		.input(
			z.object({
				quotationId: z.string().uuid(),
				status: z.enum(["draft", "sent", "accepted", "rejected"]).optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar que existe y pertenece al usuario
			const [existing] = await db
				.select()
				.from(quotations)
				.where(eq(quotations.id, input.quotationId))
				.limit(1);

			if (!existing) {
				throw new ORPCError("NOT_FOUND", {
					message: "Cotización no encontrada",
				});
			}

			const userRole = context.userRole;
			if (userRole !== ROLES.ADMIN && existing.salesUserId !== context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para editar esta cotización",
				});
			}

			// Actualizar
			const [updated] = await db
				.update(quotations)
				.set({
					status: input.status,
					notes: input.notes,
					updatedAt: new Date(),
				})
				.where(eq(quotations.id, input.quotationId))
				.returning();

			return updated;
		}),

	// Listar cotizaciones por oportunidad
	listQuotationsByOpportunity: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const result = await db
				.select()
				.from(quotations)
				.where(eq(quotations.opportunityId, input.opportunityId))
				.orderBy(desc(quotations.createdAt));

			return result;
		}),

	// Eliminar cotización
	deleteQuotation: crmProcedure
		.input(z.object({ quotationId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar que existe y pertenece al usuario
			const [existing] = await db
				.select()
				.from(quotations)
				.where(eq(quotations.id, input.quotationId))
				.limit(1);

			if (!existing) {
				throw new ORPCError("NOT_FOUND", {
					message: "Cotización no encontrada",
				});
			}

			const userRole = context.userRole;
			if (userRole !== ROLES.ADMIN && existing.salesUserId !== context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para eliminar esta cotización",
				});
			}

			await db.delete(quotations).where(eq(quotations.id, input.quotationId));

			return { success: true };
		}),
};
