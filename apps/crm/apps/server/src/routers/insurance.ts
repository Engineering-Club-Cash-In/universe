import { z } from "zod";
import { db } from "../db";
import { insuranceCosts } from "../db/schema";
import { publicProcedure } from "../lib/orpc";
import { sql, lte, gte } from "drizzle-orm";

/**
 * Función para calcular el costo de seguro basado en el tipo de vehículo y el monto asegurado
 * Según el Excel:
 * - Membresía = VLOOKUP(monto, columna 5) - GPS (148.2)
 * - Seguro = VLOOKUP(monto, columna según tipo) + Membresía
 */
async function getInsuranceCost(
	insuredAmount: number,
	vehicleType: string
): Promise<{ insuranceCost: number; membershipCost: number }> {
	const GPS_COST = 148.2;

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

		const membershipFromTable = Number(minResult?.membership || 0);
		const membershipCost = membershipFromTable - GPS_COST;
		const baseInsurance = Number(minResult?.inrexsa || 0);
		const insuranceCost = baseInsurance + membershipCost;

		return {
			insuranceCost: Math.round(insuranceCost * 100) / 100,
			membershipCost: Math.round(membershipCost * 100) / 100,
		};
	}

	// Calcular membresía: VLOOKUP columna 5 - GPS
	const membershipFromTable = Number(result.membership);
	const membershipCost = membershipFromTable - GPS_COST;

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

	// Seguro = base + membresía (según fórmula del Excel)
	const insuranceCost = baseInsurance + membershipCost;

	return {
		insuranceCost: Math.round(insuranceCost * 100) / 100,
		membershipCost: Math.round(membershipCost * 100) / 100,
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
					])
					.default("particular"),
			})
		)
		.handler(async ({ input }) => {
			const result = await getInsuranceCost(
				input.insuredAmount,
				input.vehicleType
			);
			return result;
		}),
};
