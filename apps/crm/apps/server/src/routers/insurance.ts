import { and, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { insuranceCosts } from "../db/schema";
import { publicProcedure } from "../lib/orpc";

/** Tipos de bus RCDP */
const BUS_TYPES = ["microbus_20", "microbus_35", "microbus_36plus"] as const;

function isBusType(vehicleType: string): boolean {
	return (BUS_TYPES as readonly string[]).includes(vehicleType);
}

/**
 * Función para calcular el costo de seguro basado en el tipo de vehículo y el monto asegurado
 * Según el Excel:
 * - Membresía = VLOOKUP(monto, columna 5) - GPS (148.2)
 * - Seguro = VLOOKUP(monto, columna según tipo) + Membresía
 * Para tipos de bus RCDP: la membresía es 0 (RCDP ya incluido en la tarifa)
 */
async function getInsuranceCost(
	insuredAmount: number,
	vehicleType: string,
): Promise<{ baseInsuranceCost: number; membershipCost: number }> {
	const isBus = isBusType(vehicleType);

	// Para bus, filtrar solo filas que tengan datos en la columna específica del subtipo
	const busNotNullFilter = isBus
		? isNotNull(getBusColumn(vehicleType))
		: undefined;

	// Buscar el registro más cercano (VLOOKUP con aproximación)
	const conditions = [lte(insuranceCosts.price, insuredAmount)];
	if (busNotNullFilter) conditions.push(busNotNullFilter);

	const [result] = await db
		.select()
		.from(insuranceCosts)
		.where(and(...conditions))
		.orderBy(sql`${insuranceCosts.price} DESC`)
		.limit(1);

	if (!result) {
		// Si no hay resultado, devolver el primer registro (precio mínimo)
		const minConditions = busNotNullFilter ? [busNotNullFilter] : undefined;
		const [minResult] = await db
			.select()
			.from(insuranceCosts)
			.where(minConditions ? and(...minConditions) : undefined)
			.orderBy(insuranceCosts.price)
			.limit(1);

		if (isBus) {
			const baseInsurance = getBusInsuranceValue(minResult, vehicleType);
			return {
				baseInsuranceCost: Math.round(baseInsurance * 100) / 100,
				membershipCost: 0,
			};
		}

		const membershipFromTable = Number(minResult?.membership || 0);
		const baseInsurance = Number(minResult?.inrexsa || 0);

		return {
			baseInsuranceCost: Math.round(baseInsurance * 100) / 100,
			membershipCost: Math.round(membershipFromTable * 100) / 100,
		};
	}

	// Para tipos de bus: RCDP incluido, membresía = 0
	if (isBus) {
		const baseInsurance = getBusInsuranceValue(result, vehicleType);
		return {
			baseInsuranceCost: Math.round(baseInsurance * 100) / 100,
			membershipCost: 0,
		};
	}

	// Membresía: valor crudo de la tabla (sin restar GPS)
	const membershipFromTable = Number(result.membership);

	// Determinar qué columna usar según el tipo de vehículo para el seguro base
	let baseInsurance = 0;
	switch (vehicleType.toLowerCase()) {
		case "uber":
		case "particular":
		case "nuevo":
			baseInsurance = Number(result.inrexsa);
			break;
		case "pickup":
			baseInsurance = Number(result.pickUp);
			break;
		case "panel":
		case "camion":
		case "microbus":
			baseInsurance = Number(result.panelCamionMicrobus);
			break;
		default:
			baseInsurance = Number(result.inrexsa);
	}

	return {
		baseInsuranceCost: Math.round(baseInsurance * 100) / 100,
		membershipCost: Math.round(membershipFromTable * 100) / 100,
	};
}

/** Obtener la columna de la tabla según subtipo de bus */
function getBusColumn(vehicleType: string) {
	switch (vehicleType) {
		case "microbus_20":
			return insuranceCosts.busHasta20;
		case "microbus_35":
			return insuranceCosts.bus21a35;
		case "microbus_36plus":
			return insuranceCosts.busMas35;
		default:
			return insuranceCosts.busHasta20;
	}
}

/** Obtener valor de seguro de bus según subtipo */
function getBusInsuranceValue(
	result: typeof insuranceCosts.$inferSelect | undefined,
	vehicleType: string,
): number {
	if (!result) return 0;
	switch (vehicleType) {
		case "microbus_20":
			return Number(result.busHasta20 || 0);
		case "microbus_35":
			return Number(result.bus21a35 || 0);
		case "microbus_36plus":
			return Number(result.busMas35 || 0);
		default:
			return 0;
	}
}

export const insuranceRouter = {
	// Obtener costo de seguro
	getInsuranceCost: publicProcedure
		.input(
			z.object({
				insuredAmount: z.number().positive(),
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
			}),
		)
		.handler(async ({ input }) => {
			const result = await getInsuranceCost(
				input.insuredAmount,
				input.vehicleType,
			);
			return result;
		}),
};
