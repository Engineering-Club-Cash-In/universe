/** IVA de Guatemala (12%) */
export const IVA_FACTOR = 1.12;

/** Tasa de interés fija para autocompra usada en el cálculo de intereses del detalle */
export const AUTOCOMPRA_INTEREST_RATE = 0.0178;

/** Gastos administrativos fijos para sobre vehículo */
export const FIXED_ADMIN_COST = 600;

/** Garantía mobiliaria */
export const GARANTIA_MOBILIARIA = 400;

/** Garantía mobiliaria para crédito interno (empleados) */
export const GARANTIA_MOBILIARIA_INTERNO = 300;

/** Contrato leasing */
export const CONTRATO_LEASING = 400;

/** Costo fijo del GPS (se resta de la membresía cruda para obtener la neta) */
export const GPS_COST = 148.2;

interface QuotationInput {
	creditType: "autocompra" | "sobre_vehiculo";
	vehicleValue: number;
	downPayment: number;
	interestRate: number;
	termMonths: number;
	insuranceCost: number;
	gpsCost: number;
	transferCost: number;
	royaltyPercentage: number;
	rcdpCost: number;
	isInterno?: boolean;
}

export interface QuotationResult {
	amountToFinance: number;
	calculatedRoyalty: number;
	calculatedInterest: number;
	adminCost: number;
	totalFinanced: number;
	monthlyPayment: number;
}

/**
 * Calcula la cuota mensual nivelada (según Excel).
 * Incluye seguro y GPS como costos adicionales a la cuota base.
 */
export function calculateMonthlyPayment(
	principal: number,
	monthlyRate: number,
	termMonths: number,
	insuranceCost: number,
	gpsCost: number,
): number {
	// La tasa incluye IVA (12%)
	const r = (monthlyRate / 100) * IVA_FACTOR;

	if (r === 0) return principal / termMonths;

	const factor = (1 + r) ** termMonths;
	const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);

	// Agregar seguro y GPS a la cuota mensual
	return Math.round((baseMonthlyPayment + insuranceCost + gpsCost) * 100) / 100;
}

/**
 * Calcula todos los valores de una cotización según el tipo de crédito.
 *
 * - Sobre vehículo: los cálculos se hacen sobre el monto solicitado directamente.
 *   Los gastos se descuentan del desembolso al cliente.
 * - Autocompra: los cálculos se hacen sobre B22 (base intermedia que incluye
 *   monto a financiar + traspaso + garantía + leasing + admin + GPS + seguro).
 *   Los gastos se suman al monto a financiar.
 */
export function calculateQuotation(input: QuotationInput): QuotationResult {
	const isSobreVehiculo = input.creditType === "sobre_vehiculo";

	// En sobre vehículo: downPayment = monto solicitado directo
	// En autocompra: monto a financiar = valor del vehículo - enganche
	const amountToFinance = isSobreVehiculo
		? input.downPayment
		: input.vehicleValue - input.downPayment;

	const royaltyPercentage = input.royaltyPercentage || 4.0;

	let calculatedRoyalty: number;
	let calculatedInterest: number;
	let adminCost: number;
	let totalFinanced: number;

	if (isSobreVehiculo) {
		// Royalty = % del monto solicitado
		calculatedRoyalty = Math.ceil(amountToFinance * (royaltyPercentage / 100));

		// Intereses = monto solicitado × tasa × IVA
		const interestRate = input.interestRate / 100;
		calculatedInterest =
			Math.round(amountToFinance * interestRate * IVA_FACTOR * 100) / 100;

		// Gastos administrativos fijos
		adminCost = FIXED_ADMIN_COST;

		// Total financiado = monto solicitado (los gastos se descuentan del desembolso)
		totalFinanced = amountToFinance;
	} else {
		// Constantes según tipo de crédito (interno vs normal)
		const garantia = input.isInterno
			? GARANTIA_MOBILIARIA_INTERNO
			: GARANTIA_MOBILIARIA;
		const leasing = input.isInterno ? 0 : CONTRATO_LEASING;
		const adminFijo = input.isInterno ? 0 : FIXED_ADMIN_COST;
		const gps = input.isInterno ? 0 : input.gpsCost;
		const seguro = input.insuranceCost;

		// B22 = Monto a financiar + Traspaso + Garantía + Leasing + Admin fijo + GPS + Seguro
		const b22 =
			amountToFinance +
			input.transferCost +
			garantia +
			leasing +
			adminFijo +
			gps +
			seguro;

		// Royalty = % de B22 redondeado hacia arriba
		calculatedRoyalty = Math.ceil(b22 * (royaltyPercentage / 100));

		// Interés = ROUNDUP(B22 * tasa autocompra) + RCDP (para microbuses)
		calculatedInterest =
			Math.ceil(b22 * AUTOCOMPRA_INTEREST_RATE) + input.rcdpCost;

		// Gastos Admin = Garantía + Royalty + Leasing + Admin fijo + Intereses + GPS + Seguro
		const extraCost = calculatedInterest + gps + seguro;
		adminCost = garantia + calculatedRoyalty + leasing + adminFijo + extraCost;

		// Total financiado = monto a financiar + costos financiados
		const financedCosts = input.transferCost + adminCost;
		totalFinanced = amountToFinance + financedCosts;
	}

	const effectiveGpsCost =
		!isSobreVehiculo && input.isInterno ? 0 : input.gpsCost;

	const monthlyPayment = calculateMonthlyPayment(
		totalFinanced,
		input.interestRate,
		input.termMonths,
		input.insuranceCost,
		effectiveGpsCost,
	);

	return {
		amountToFinance,
		calculatedRoyalty,
		calculatedInterest,
		adminCost: Math.round(adminCost * 100) / 100,
		totalFinanced,
		monthlyPayment,
	};
}
