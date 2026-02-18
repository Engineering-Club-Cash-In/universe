import { lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { insuranceCosts } from "../db/schema";
import { publicProcedure } from "../lib/orpc";

/** Tipos de bus RCDP */
const BUS_TYPES = ["microbus_20", "microbus_35", "microbus_36plus"] as const;

/**
 * Costos RCDP fijos por subtipo de bus (del Excel, hoja "Costo seguro" celdas G2, H2, I2).
 * Se suma RCDP/3 al seguro base mensual.
 */
const RCDP_COST: Record<string, number> = {
	microbus_20: 561.99,
	microbus_35: 945.17,
	microbus_36plus: 1328.35,
};

/** Factor de ajuste de membresía para tipos de bus RCDP */
const BUS_MEMBERSHIP_FACTOR = 1.1;

function isBusType(vehicleType: string): boolean {
	return (BUS_TYPES as readonly string[]).includes(vehicleType);
}

/**
 * Función para calcular el costo de seguro basado en el tipo de vehículo y el monto asegurado.
 * Según el Excel:
 * - Seguro base = VLOOKUP(monto, columna según tipo)
 * - Membresía = VLOOKUP(monto, columna 5)
 * Para tipos de bus RCDP:
 * - Seguro base = panelCamionMicrobus + RCDP/3
 * - Membresía = membership × 1.1
 */
async function getInsuranceCost(
	insuredAmount: number,
	vehicleType: string,
): Promise<{
	baseInsuranceCost: number;
	membershipCost: number;
	rcdpCost: number;
}> {
	// Buscar el registro más cercano (VLOOKUP con aproximación)
	const [result] = await db
		.select()
		.from(insuranceCosts)
		.where(lte(insuranceCosts.price, insuredAmount))
		.orderBy(sql`${insuranceCosts.price} DESC`)
		.limit(1);

	if (!result) {
		// Si no hay resultado, devolver el primer registro (precio mínimo)
		const [minResult] = await db
			.select()
			.from(insuranceCosts)
			.orderBy(insuranceCosts.price)
			.limit(1);

		if (!minResult)
			return { baseInsuranceCost: 0, membershipCost: 0, rcdpCost: 0 };
		return calculateCosts(minResult, vehicleType);
	}

	return calculateCosts(result, vehicleType);
}

/** Calcular costos de seguro y membresía según tipo de vehículo */
function calculateCosts(
	result: typeof insuranceCosts.$inferSelect,
	vehicleType: string,
): { baseInsuranceCost: number; membershipCost: number; rcdpCost: number } {
	const isBus = isBusType(vehicleType);

	// Determinar seguro base según tipo
	let baseInsurance = 0;
	if (isBus) {
		// Bus RCDP: panelCamionMicrobus + RCDP/3
		const rcdpExtra = (RCDP_COST[vehicleType] || 0) / 3;
		baseInsurance = Number(result.panelCamionMicrobus) + rcdpExtra;
	} else {
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
	}

	// Determinar membresía según tipo
	const membershipFromTable = Number(result.membership);
	const membershipCost = isBus
		? membershipFromTable * BUS_MEMBERSHIP_FACTOR
		: membershipFromTable;

	// Costo RCDP completo (para gastos admin en el cotizador)
	const rcdpCost = isBus ? RCDP_COST[vehicleType] || 0 : 0;

	return {
		baseInsuranceCost: Math.round(baseInsurance * 100) / 100,
		membershipCost: Math.round(membershipCost * 100) / 100,
		rcdpCost: Math.round(rcdpCost * 100) / 100,
	};
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
