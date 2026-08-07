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

/** Redondea al centavo más cercano. */
export function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Redondea hacia arriba al quetzal entero (sin centavos) — así se calculan hoy el
 * royalty y el interés de autocompra en el Excel de referencia. No confundir con
 * redondeo a centavos: `ceilMoney(10.01)` da `11`, no `10.01`.
 */
export function ceilMoney(value: number): number {
	return Math.ceil(value);
}

export interface QuotationInput {
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
	rcdpCost: number;
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

	// TODO(negocio): comportamiento heredado, no re-verificado en este trabajo — a
	// tasa 0% la cuota NO suma seguro/GPS (a diferencia de la rama con tasa > 0), y
	// generateAmortizationTable() más abajo divide por cero con esta misma tasa
	// (factor - 1 === 0), produciendo NaN en la tabla. En la práctica no debería
	// ocurrir porque interestRate es positive() en el schema del servidor, pero el
	// formulario del cotizador sí permite escribir 0% en pantalla.
	if (r === 0) return principal / termMonths;

	const factor = (1 + r) ** termMonths;
	const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);

	// Agregar seguro y GPS a la cuota mensual
	return roundMoney(baseMonthlyPayment + insuranceCost + gpsCost);
}

/**
 * Calcula todos los valores de una cotización según el tipo de crédito.
 *
 * - Sobre vehículo: los cálculos se hacen sobre el monto solicitado directamente.
 *   Los gastos se descuentan del desembolso al cliente, no se suman al financiamiento.
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
		calculatedRoyalty = ceilMoney(amountToFinance * (royaltyPercentage / 100));

		// Intereses = monto solicitado × tasa × IVA
		const interestRate = input.interestRate / 100;
		calculatedInterest = roundMoney(amountToFinance * interestRate * IVA_FACTOR);

		// Gastos administrativos fijos
		adminCost = FIXED_ADMIN_COST;

		// Total financiado = monto solicitado (los gastos se descuentan del desembolso)
		totalFinanced = amountToFinance;
	} else {
		// Constantes según tipo de crédito (interno vs normal)
		const garantia = input.isInterno ? GARANTIA_MOBILIARIA_INTERNO : GARANTIA_MOBILIARIA;
		const leasing = input.isInterno ? 0 : CONTRATO_LEASING;
		const adminFijo = input.isInterno ? 0 : FIXED_ADMIN_COST;
		const gps = input.isInterno ? 0 : input.gpsCost;
		const seguro = input.insuranceCost;

		// B22 = Monto a financiar + Traspaso + Garantía + Leasing + Admin fijo + GPS + Seguro
		const b22 =
			amountToFinance + input.transferCost + garantia + leasing + adminFijo + gps + seguro;

		// Royalty = % de B22 redondeado hacia arriba
		calculatedRoyalty = ceilMoney(b22 * (royaltyPercentage / 100));

		// Interés = ROUNDUP(B22 * tasa autocompra) — sin RCDP
		calculatedInterest = ceilMoney(b22 * AUTOCOMPRA_INTEREST_RATE);

		// Gastos Admin = Garantía + Royalty + Leasing + Admin fijo + Intereses + RCDP + GPS + Seguro
		const extraCost = calculatedInterest + input.rcdpCost + gps + seguro;
		adminCost = garantia + calculatedRoyalty + leasing + adminFijo + extraCost;

		// Total financiado = monto a financiar + costos financiados
		const financedCosts = input.transferCost + adminCost;
		totalFinanced = amountToFinance + financedCosts;
	}

	const effectiveGpsCost = !isSobreVehiculo && input.isInterno ? 0 : input.gpsCost;

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
		rcdpCost: input.rcdpCost,
		adminCost: roundMoney(adminCost),
		totalFinanced,
		monthlyPayment,
	};
}

export interface AmortizationRow {
	period: number;
	initialBalance: number;
	interestPlusVAT: number;
	principal: number;
	finalBalance: number;
}

/** Genera la tabla de amortización (cuota nivelada, IVA incluido en el interés). */
export function generateAmortizationTable(
	totalFinanced: number,
	monthlyRate: number,
	termMonths: number,
): AmortizationRow[] {
	const table: AmortizationRow[] = [];
	let balance = totalFinanced;
	const r = monthlyRate / 100;
	const rWithVAT = r * IVA_FACTOR;

	// Calcular la cuota base (sin seguro ni GPS)
	// TODO(negocio): comportamiento heredado — a tasa 0% (rWithVAT === 0), `factor - 1`
	// da 0 y esta división produce NaN en toda la tabla. Sin guard, igual que antes de
	// este trabajo. Ver TODO en calculateMonthlyPayment().
	const factor = (1 + rWithVAT) ** termMonths;
	const baseMonthlyPayment = (totalFinanced * (rWithVAT * factor)) / (factor - 1);

	// Período 0 (inicial)
	const initialInterest = balance * r;
	const initialInterestWithVAT = initialInterest * IVA_FACTOR;

	table.push({
		period: 0,
		initialBalance: roundMoney(balance),
		interestPlusVAT: roundMoney(initialInterestWithVAT),
		principal: 0,
		finalBalance: roundMoney(balance),
	});

	// Períodos 1 a termMonths
	for (let i = 1; i <= termMonths; i++) {
		const interest = balance * r;
		const interestWithVAT = interest * IVA_FACTOR;
		const principalPayment = baseMonthlyPayment - interestWithVAT;
		const newBalance = balance - principalPayment;
		const clampedBalance = newBalance > 0 ? newBalance : 0;

		table.push({
			period: i,
			initialBalance: roundMoney(balance),
			interestPlusVAT: roundMoney(interestWithVAT),
			principal: roundMoney(principalPayment),
			finalBalance: roundMoney(clampedBalance),
		});

		balance = newBalance;
	}

	return table;
}
