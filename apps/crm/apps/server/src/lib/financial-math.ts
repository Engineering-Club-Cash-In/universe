/**
 * Calculates the present value of a series of future payments
 */
export function PV(
	rate: number,
	nper: number,
	pmt: number,
	fv = 0,
	type: 0 | 1 = 0,
): number {
	if (rate === -1) throw new Error("Rate cannot be -100%");
	if (nper <= 0) throw new Error("Number of periods must be positive");

	if (rate === 0) {
		return -pmt * nper - fv;
	}

	const pvif = (1 + rate) ** -nper;

	if (type === 1) {
		return (-pmt * (1 + rate) * (1 - pvif)) / rate - fv * pvif;
	}
	return (-pmt * (1 - pvif)) / rate - fv * pvif;
}

/**
 * Calculates the payment for a loan based on constant payments and a constant interest rate
 */
export function PMT(
	rate: number,
	nper: number,
	pv: number,
	fv = 0,
	type: 0 | 1 = 0,
): number {
	if (rate === -1) throw new Error("Rate cannot be -100%");
	if (nper <= 0) throw new Error("Number of periods must be positive");

	if (rate === 0) {
		return -(pv + fv) / nper;
	}

	const pvif = (1 + rate) ** -nper;

	if (type === 1) {
		return (
			(-rate * pv) / ((1 + rate) * (1 - pvif)) -
			(fv * rate) / ((1 + rate) * (pvif - 1))
		);
	}
	return (-rate * pv) / (1 - pvif) - (fv * rate) / (pvif - 1);
}

export interface CreditCalculationParams {
	annualRate: number;
	termMonths: number;
	maxDebtRatio: number;
	maxVariableDebtRatio: number;
}

export interface AnalysisResult {
	resumen_mensual: Array<{
		mes: string;
		saldo_inicial: number;
		total_debitos: number;
		total_creditos: number;
		saldo_final: number;
		ingresos: { fijos: number; variables: number };
		gastos: { fijos: number; variables: number };
	}>;
	promedio_mensual: {
		promedio_ingresos_fijos: number;
		promedio_ingresos_variables: number;
		promedio_gastos_fijos: number;
		promedio_gastos_variables: number;
		disponibilidad_economica: number;
	};
}

export function calculateCreditCapacity(
	analysis: AnalysisResult,
	params: CreditCalculationParams = {
		annualRate: 0.18,
		termMonths: 60,
		maxDebtRatio: 0.2,
		maxVariableDebtRatio: 0.3,
	},
) {
	const months = analysis.resumen_mensual;
	const monthCount = months.length || 1;

	let guaranteedIncome = 0;
	let fixedExpenses = 0;
	for (const month of months) {
		guaranteedIncome += month.total_creditos;
		fixedExpenses += month.total_debitos;
	}
	guaranteedIncome = guaranteedIncome / monthCount;
	fixedExpenses = fixedExpenses / monthCount;

	// Método 1: Flujo libre
	const freeFlux = guaranteedIncome - fixedExpenses;

	// Método 2: Basado en ingresos
	const method2MaxAmount = params.maxDebtRatio * (guaranteedIncome * 0.5);

	// Método 3: Basado en gastos variables
	const method3MaxAmount = params.maxVariableDebtRatio * fixedExpenses;

	// Estimación de capacidad
	const minPayment = Math.min(method2MaxAmount, method3MaxAmount);
	const maxPayment = Math.max(method2MaxAmount, method3MaxAmount);
	const adjustedPayment = (freeFlux + method2MaxAmount + method3MaxAmount) / 3;

	const maxCreditAmount = Math.abs(
		PV(
			params.annualRate / 12,
			params.termMonths,
			method2MaxAmount,
			undefined,
			0,
		),
	);

	return {
		guaranteedIncome,
		fixedExpenses,
		freeFlux,
		method2MaxAmount,
		method3MaxAmount,
		minPayment,
		maxPayment,
		adjustedPayment,
		maxCreditAmount,
	};
}
