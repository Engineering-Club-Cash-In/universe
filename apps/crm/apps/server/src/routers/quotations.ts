import { z } from "zod";
import { db } from "../db";
import { quotations, vehicles } from "../db/schema";
import { crmProcedure } from "../lib/orpc";
import { eq, and, desc } from "drizzle-orm";
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

	const factor = Math.pow(1 + r, termMonths);
	const baseMonthlyPayment = principal * (r * factor) / (factor - 1);

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
	insuranceCost: number,
	gpsCost: number,
): AmortizationRow[] {
	const table: AmortizationRow[] = [];
	let balance = totalFinanced;
	const r = monthlyRate / 100;
	const VAT = 0.12; // 12% IVA

	// Calcular la cuota base (sin seguro ni GPS)
	const rWithVAT = r * (1 + VAT);
	const factor = Math.pow(1 + rWithVAT, termMonths);
	const baseMonthlyPayment = totalFinanced * (rWithVAT * factor) / (factor - 1);

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
					.enum(["particular", "uber", "pickup", "nuevo", "panel", "camion", "microbus"])
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
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Validar que el usuario sea sales o admin
			const userRole = context.userRole;
			if (userRole !== ROLES.SALES && userRole !== ROLES.ADMIN) {
				throw new Error("Solo usuarios de ventas pueden crear cotizaciones");
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

			// Costos que se financian (NO incluyen seguro ni GPS)
			const financedCosts =
				input.transferCost + input.adminCost + input.membershipCost;

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
				throw new Error("Cotización no encontrada");
			}

			// Validar acceso
			const userRole = context.userRole;
			if (
				userRole !== ROLES.ADMIN &&
				quotation.salesUserId !== context.userId
			) {
				throw new Error("No tienes permiso para ver esta cotización");
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
				throw new Error("Cotización no encontrada");
			}

			const userRole = context.userRole;
			if (
				userRole !== ROLES.ADMIN &&
				existing.salesUserId !== context.userId
			) {
				throw new Error("No tienes permiso para editar esta cotización");
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
				throw new Error("Cotización no encontrada");
			}

			const userRole = context.userRole;
			if (
				userRole !== ROLES.ADMIN &&
				existing.salesUserId !== context.userId
			) {
				throw new Error("No tienes permiso para eliminar esta cotización");
			}

			await db.delete(quotations).where(eq(quotations.id, input.quotationId));

			return { success: true };
		}),
};
