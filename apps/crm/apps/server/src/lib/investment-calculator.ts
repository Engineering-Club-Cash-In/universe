export interface AmortizationRow {
	month: number;
	initialBalance: number;
	interestPlusVat: number;
	amortization: number;
	totalToReceive: number;
}

export interface InvestmentCalculationResult {
	amount: number;
	monthlyRate: number;
	termMonths: number;
	modality: "traditional" | "maturity" | "compound";
	isSmallTaxpayer: boolean;
	totalInterest: number;
	totalToReceive: number;
	amortizationTable: AmortizationRow[];
}

function getVatRate(isSmallTaxpayer: boolean): number {
	return isSmallTaxpayer ? 0.05 : 0.12;
}

/**
 * Modalidad Tradicional: amortizacion mensual (capital + interes cada mes)
 * Similar a PMT pero desde perspectiva del inversionista (recibe en vez de pagar)
 */
function calculateTraditional(
	amount: number,
	monthlyRate: number,
	termMonths: number,
	vatRate: number,
): { totalInterest: number; totalToReceive: number; table: AmortizationRow[] } {
	const r = monthlyRate / 100;
	const table: AmortizationRow[] = [];
	let balance = amount;
	let totalInterest = 0;
	let totalToReceive = 0;

	// Calculo de cuota fija (PMT) con interes bruto (sin IVA para amortizacion)
	const rVat = r * (1 + vatRate);
	const factor = (1 + rVat) ** termMonths;
	const pmt = (amount * rVat * factor) / (factor - 1);

	for (let i = 1; i <= termMonths; i++) {
		const interest = balance * r;
		const interestWithVat = interest * (1 + vatRate);
		const amortization = pmt - interestWithVat;
		const newBalance = balance - amortization;

		// El inversionista recibe la cuota neta (interes neto despues de impuesto + amortizacion)
		// Interes neto = interes - ISR. Para simplificar, el total a recibir = amortizacion + interes - IVA
		// Segun la calculadora: Total a Recibir = amortizacion + (interes - IVA del interes)
		const interestNet = interest - interest * vatRate;
		const monthlyReceive = amortization + interestNet;

		table.push({
			month: i,
			initialBalance: Math.round(balance * 100) / 100,
			interestPlusVat: Math.round(interestWithVat * 100) / 100,
			amortization: Math.round(amortization * 100) / 100,
			totalToReceive: Math.round(monthlyReceive * 100) / 100,
		});

		totalInterest += interestNet;
		totalToReceive += monthlyReceive;
		balance = newBalance;
	}

	return {
		totalInterest: Math.round(totalInterest * 100) / 100,
		totalToReceive: Math.round(totalToReceive * 100) / 100,
		table,
	};
}

/**
 * Modalidad Al Vencimiento: solo interes mensual, capital devuelto en ultimo mes
 */
function calculateMaturity(
	amount: number,
	monthlyRate: number,
	termMonths: number,
	vatRate: number,
): { totalInterest: number; totalToReceive: number; table: AmortizationRow[] } {
	const r = monthlyRate / 100;
	const table: AmortizationRow[] = [];
	let totalInterest = 0;
	let totalToReceive = 0;

	const monthlyInterest = amount * r;
	const monthlyInterestWithVat = monthlyInterest * (1 + vatRate);
	const monthlyInterestNet = monthlyInterest - monthlyInterest * vatRate;

	for (let i = 1; i <= termMonths; i++) {
		const isLastMonth = i === termMonths;
		const amortization = isLastMonth ? amount : 0;
		const monthlyReceive = monthlyInterestNet + amortization;

		table.push({
			month: i,
			initialBalance: Math.round(amount * 100) / 100,
			interestPlusVat: Math.round(monthlyInterestWithVat * 100) / 100,
			amortization: Math.round(amortization * 100) / 100,
			totalToReceive: Math.round(monthlyReceive * 100) / 100,
		});

		totalInterest += monthlyInterestNet;
		totalToReceive += monthlyReceive;
	}

	return {
		totalInterest: Math.round(totalInterest * 100) / 100,
		totalToReceive: Math.round(totalToReceive * 100) / 100,
		table,
	};
}

/**
 * Modalidad Interes Compuesto: todo al final, interes se reinvierte mes a mes
 */
function calculateCompound(
	amount: number,
	monthlyRate: number,
	termMonths: number,
	vatRate: number,
): { totalInterest: number; totalToReceive: number; table: AmortizationRow[] } {
	const r = monthlyRate / 100;
	const table: AmortizationRow[] = [];
	let balance = amount;

	for (let i = 1; i <= termMonths; i++) {
		const interest = balance * r;
		const interestWithVat = interest * (1 + vatRate);
		const isLastMonth = i === termMonths;
		const amortization = isLastMonth ? balance : 0;

		// En compuesto, el interes se suma al saldo (neto de impuestos)
		const interestNet = interest - interest * vatRate;
		const newBalance = balance + interestNet;

		table.push({
			month: i,
			initialBalance: Math.round(balance * 100) / 100,
			interestPlusVat: Math.round(interestWithVat * 100) / 100,
			amortization: Math.round(amortization * 100) / 100,
			totalToReceive: Math.round((isLastMonth ? newBalance : 0) * 100) / 100,
		});

		balance = newBalance;
	}

	const totalInterest = balance - amount;
	const totalToReceive = balance;

	return {
		totalInterest: Math.round(totalInterest * 100) / 100,
		totalToReceive: Math.round(totalToReceive * 100) / 100,
		table,
	};
}

/**
 * Funcion principal: calcular escenario de inversion
 */
export function calculateInvestment(
	amount: number,
	monthlyRate: number,
	termMonths: number,
	modality: "traditional" | "maturity" | "compound",
	isSmallTaxpayer = false,
): InvestmentCalculationResult {
	const vatRate = getVatRate(isSmallTaxpayer);

	let result: {
		totalInterest: number;
		totalToReceive: number;
		table: AmortizationRow[];
	};

	switch (modality) {
		case "traditional":
			result = calculateTraditional(amount, monthlyRate, termMonths, vatRate);
			break;
		case "maturity":
			result = calculateMaturity(amount, monthlyRate, termMonths, vatRate);
			break;
		case "compound":
			result = calculateCompound(amount, monthlyRate, termMonths, vatRate);
			break;
	}

	return {
		amount,
		monthlyRate,
		termMonths,
		modality,
		isSmallTaxpayer,
		totalInterest: result.totalInterest,
		totalToReceive: result.totalToReceive,
		amortizationTable: result.table,
	};
}

/**
 * Modo "Calcular Objetivo": dado un rendimiento deseado mensual,
 * calcula cuanto capital se necesita invertir.
 * Solo aplica para modalidad "compound" segun la calculadora externa.
 */
export function calculateGoal(
	desiredMonthlyAmount: number,
	termMonths: number,
	monthlyRate = 1.5,
	isSmallTaxpayer = false,
): { requiredCapital: number; scenario: InvestmentCalculationResult } {
	const vatRate = getVatRate(isSmallTaxpayer);
	const r = monthlyRate / 100;
	const netRate = r * (1 - vatRate);

	// Para interes compuesto: FV = PV * (1 + netRate)^n
	// Queremos que el interes mensual al final sea >= desiredMonthlyAmount
	// PV = desiredMonthlyAmount / netRate (simplificado para rendimiento sobre saldo)
	const requiredCapital =
		Math.round((desiredMonthlyAmount / netRate) * 100) / 100;

	const scenario = calculateInvestment(
		requiredCapital,
		monthlyRate,
		termMonths,
		"compound",
		isSmallTaxpayer,
	);

	return { requiredCapital, scenario };
}
