import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	companies,
	leads,
	opportunities,
	quotations,
	vehicles,
} from "../db/schema";
import { buildServerInsurancePersistence } from "../lib/insurance-selection";
import { crmProcedure } from "../lib/orpc";
import {
	calculateQuotation,
	generateAmortizationTable,
	type AmortizationRow,
} from "../lib/quotation-calculator";
import {
	canManageAnyQuotation,
	canManageQuotations,
} from "../lib/quotation-permissions";
import { getInsuranceCost } from "./insurance";

type Simplify<T> = { [K in keyof T]: T[K] };

type QuotationWithClient = Simplify<
	typeof quotations.$inferSelect & {
		leadFirstName: string | null;
		leadLastName: string | null;
		companyName: string | null;
	}
>;

type QuotationWithClientAndAmortization = QuotationWithClient & {
	amortizationTable: AmortizationRow[];
};

const quotationWithClientOutput = z.custom<QuotationWithClient>();
const quotationWithClientAndAmortizationOutput =
	z.custom<QuotationWithClientAndAmortization>();

function flattenQuotationClient(row: {
	quotation: typeof quotations.$inferSelect;
	leadFirstName: string | null;
	leadLastName: string | null;
	companyName: string | null;
}): QuotationWithClient {
	return {
		...row.quotation,
		leadFirstName: row.leadFirstName,
		leadLastName: row.leadLastName,
		companyName: row.companyName,
	};
}

const quotationClientSelect = {
	quotation: quotations,
	leadFirstName: leads.firstName,
	leadLastName: leads.lastName,
	companyName: companies.name,
};

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
				vehicleCondition: z.enum(["new", "used"]).default("used"),
				vehicleOrigin: z
					.enum(["agencia", "rodado", "importado", "subasta", "otro"])
					.default("agencia"),
				creditType: z
					.enum(["autocompra", "sobre_vehiculo"])
					.default("autocompra"),
				vehicleValue: z.number().positive(),
				insuredAmount: z.number().positive(),
				downPayment: z.number().positive(),
				termMonths: z.number().int().positive(),
				interestRate: z.number().positive(),
				// Usado como fallback si buildServerInsurancePersistence no tiene otro dato —
				// ver TODO junto a customerInsuranceCost más abajo (pendiente de negocio).
				insuranceCost: z.number().default(0),
				gpsCost: z.number().default(0),
				transferCost: z.number().default(0),
				// Se acepta por compatibilidad con el payload del formulario, pero el servidor
				// lo ignora: adminCost se recalcula siempre con calculateQuotation().
				adminCost: z.number().default(0),
				membershipCost: z.number().default(0),
				// Gastos adicionales para detalle de crédito
				freelanceCost: z.number().default(0),
				freelancePercentage: z.number().optional(),
				// Se acepta por compatibilidad, pero se ignora: se recalcula siempre.
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
				// Se acepta por compatibilidad, pero se ignora: se recalcula siempre.
				interestCost: z.number().default(0),
				// TODO(negocio): el servidor confía tal cual en el rcdpCost del cliente en vez
				// de derivarlo de getInsuranceCost (que también lo devuelve). Mismo patrón que
				// customerInsuranceCost — pendiente de decisión, no se toca en este trabajo.
				rcdpCost: z.number().default(0),
				vehicleTransferCost: z.number().default(0),
				isInterno: z.boolean().default(false),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const vehicleCondition =
				input.vehicleType === "nuevo" ? "new" : input.vehicleCondition;

			// Validar acceso a cotizaciones
			const userRole = context.userRole;
			if (!canManageQuotations(userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Solo ventas, supervisión de ventas y administración pueden crear cotizaciones",
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

			const serverInsurance = await getInsuranceCost(
				input.insuredAmount,
				input.vehicleType,
			);
			const insurancePersistence = buildServerInsurancePersistence({
				insuredAmount: input.insuredAmount,
				vehicleType: input.vehicleType,
				universalesCost: serverInsurance.baseInsuranceCost,
				gytCost:
					serverInsurance.provider === "gyt"
						? serverInsurance.internalInsuranceCost
						: null,
				membershipCost: input.membershipCost,
				// TODO(negocio): buildServerInsurancePersistence prioriza este valor del
				// cliente sobre el que getInsuranceCost() ya calculó arriba (ver
				// insurance-selection.ts:114-116). Es el mismo hallazgo del "doble cálculo
				// de seguro" ya documentado — pendiente de decisión, no se toca aquí.
				customerInsuranceCost: input.insuranceCost,
			});

			const isSobreVehiculo = input.creditType === "sobre_vehiculo";
			const downPaymentPercentage = isSobreVehiculo
				? 0
				: (input.downPayment / input.vehicleValue) * 100;

			// El servidor recalcula todo desde los inputs crudos — no confía en
			// adminCost/royalty/interestCost/rcdpCost que el cliente ya haya calculado.
			// Es la misma función que usa el navegador para la simulación en vivo.
			const quoteResult = calculateQuotation({
				creditType: input.creditType,
				vehicleValue: input.vehicleValue,
				downPayment: input.downPayment,
				interestRate: input.interestRate,
				termMonths: input.termMonths,
				insuranceCost: Number(insurancePersistence.seguro),
				gpsCost: input.gpsCost,
				transferCost: input.transferCost,
				royaltyPercentage: input.royaltyPercentage,
				rcdpCost: input.rcdpCost,
				isInterno: input.isInterno,
			});

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
					vehicleCondition,
					vehicleOrigin: input.vehicleOrigin,
					creditType: input.creditType,
					vehicleValue: input.vehicleValue.toString(),
					insuredAmount: input.insuredAmount.toString(),
					downPayment: input.downPayment.toString(),
					downPaymentPercentage: downPaymentPercentage.toString(),
					termMonths: input.termMonths,
					interestRate: input.interestRate.toString(),
					insuranceCost: insurancePersistence.seguro,
					gpsCost: input.gpsCost.toString(),
					transferCost: input.transferCost.toString(),
					adminCost: quoteResult.adminCost.toString(),
					membershipCost: insurancePersistence.membresiaPago,
					insuranceProvider: insurancePersistence.insuranceProvider,
					customerInsuranceCost: insurancePersistence.customerInsuranceCost,
					internalInsuranceCost: insurancePersistence.internalInsuranceCost,
					insuranceSavingsToMembership:
						insurancePersistence.insuranceSavingsToMembership,
					// Gastos adicionales para detalle de crédito
					freelanceCost: input.freelanceCost.toString(),
					freelancePercentage: input.freelancePercentage?.toString() ?? null,
					royalty: quoteResult.calculatedRoyalty.toString(),
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
					interestCost: quoteResult.calculatedInterest.toString(),
					rcdpCost: quoteResult.rcdpCost.toString(),
					vehicleTransferCost: input.vehicleTransferCost.toString(),
					isInterno: input.isInterno,
					amountToFinance: quoteResult.amountToFinance.toString(),
					totalFinanced: quoteResult.totalFinanced.toString(),
					monthlyPayment: quoteResult.monthlyPayment.toFixed(2),
					notes: input.notes,
				})
				.returning();

			return quotation;
		}),

	// Obtener cotizaciones del usuario
	getQuotations: crmProcedure.output(z.array(quotationWithClientOutput)).handler(
		async ({ context }): Promise<QuotationWithClient[]> => {
			const userRole = context.userRole;

			// Admin y supervisión ven todas; ventas solo las suyas
			if (canManageAnyQuotation(userRole)) {
				const result = await db
					.select(quotationClientSelect)
					.from(quotations)
					.leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.leftJoin(companies, eq(opportunities.companyId, companies.id))
					.orderBy(desc(quotations.createdAt));
				return result.map(flattenQuotationClient);
			}

			const result = await db
				.select(quotationClientSelect)
				.from(quotations)
				.leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.where(eq(quotations.salesUserId, context.userId))
				.orderBy(desc(quotations.createdAt));

			return result.map(flattenQuotationClient);
		},
	),

	// Obtener cotización por ID con tabla de amortización
	getQuotationById: crmProcedure
		.input(z.object({ quotationId: z.string().uuid() }))
		.output(quotationWithClientAndAmortizationOutput)
		.handler(
			async ({
				input,
				context,
			}): Promise<QuotationWithClientAndAmortization> => {
				const [row] = await db
					.select(quotationClientSelect)
					.from(quotations)
					.leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.leftJoin(companies, eq(opportunities.companyId, companies.id))
					.where(eq(quotations.id, input.quotationId))
					.limit(1);
				const quotation = row ? flattenQuotationClient(row) : null;

				if (!quotation) {
					throw new ORPCError("NOT_FOUND", {
						message: "Cotización no encontrada",
					});
				}

				// Validar acceso
				const userRole = context.userRole;
				if (
					!canManageAnyQuotation(userRole) &&
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
				);

				return {
					...quotation,
					amortizationTable,
				};
			},
		),

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
			if (
				!canManageAnyQuotation(userRole) &&
				existing.salesUserId !== context.userId
			) {
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
		.output(z.array(quotationWithClientOutput))
		.handler(async ({ input }): Promise<QuotationWithClient[]> => {
			const result = await db
				.select(quotationClientSelect)
				.from(quotations)
				.leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.where(eq(quotations.opportunityId, input.opportunityId))
				.orderBy(desc(quotations.createdAt));

			return result.map(flattenQuotationClient);
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
			if (
				!canManageAnyQuotation(userRole) &&
				existing.salesUserId !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para eliminar esta cotización",
				});
			}

			await db.delete(quotations).where(eq(quotations.id, input.quotationId));

			return { success: true };
		}),
};
