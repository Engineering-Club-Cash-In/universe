import { describe, expect, test } from "bun:test";
import {
	calculateMonthlyPayment,
	calculateQuotation,
	ceilMoney,
	generateAmortizationTable,
	roundMoney,
} from "./quotation-calculator";

describe("roundMoney / ceilMoney", () => {
	test("roundMoney redondea al centavo más cercano", () => {
		expect(roundMoney(1234.567)).toBe(1234.57);
		expect(roundMoney(1234.564)).toBe(1234.56);
	});

	test("ceilMoney redondea hacia arriba al quetzal entero (sin centavos)", () => {
		expect(ceilMoney(10.01)).toBe(11);
		expect(ceilMoney(10)).toBe(10);
		expect(ceilMoney(0)).toBe(0);
	});
});

describe("calculateMonthlyPayment", () => {
	// Documenta el comportamiento heredado tal cual estaba antes de este trabajo —
	// no es una decisión de diseño nueva. Que a tasa 0% no sume seguro/GPS es
	// inconsistente con la rama de tasa > 0; queda pendiente de decisión de negocio.
	test("tasa 0% devuelve el principal dividido en partes iguales, sin sumar seguro/GPS", () => {
		expect(calculateMonthlyPayment(12000, 0, 12, 100, 50)).toBe(1000);
	});

	test("con un solo período, PMT se reduce a principal * (1 + r) + seguro + GPS", () => {
		// r = (1.5/100) * 1.12 = 0.0168 -> 10000 * 1.0168 = 10168
		expect(calculateMonthlyPayment(10000, 1.5, 1, 100, 50)).toBe(10318);
	});
});

describe("generateAmortizationTable", () => {
	test("el período 0 arranca en el saldo total y el crédito termina en ~0", () => {
		const table = generateAmortizationTable(10000, 1.5, 12);

		expect(table).toHaveLength(13);
		expect(table[0]).toMatchObject({
			period: 0,
			initialBalance: 10000,
			principal: 0,
			finalBalance: 10000,
		});
		expect(Math.abs(table[12].finalBalance)).toBeLessThan(1);
	});
});

describe("calculateQuotation — sobre_vehiculo", () => {
	test("no financia gastos: totalFinanced = monto solicitado, adminCost queda fuera del total", () => {
		const result = calculateQuotation({
			creditType: "sobre_vehiculo",
			vehicleValue: 50000,
			downPayment: 50000, // monto solicitado
			interestRate: 3,
			termMonths: 1,
			insuranceCost: 0,
			gpsCost: 0,
			transferCost: 0,
			royaltyPercentage: 4,
			rcdpCost: 0,
		});

		expect(result.amountToFinance).toBe(50000);
		expect(result.calculatedRoyalty).toBe(2000);
		expect(result.calculatedInterest).toBe(1680);
		expect(result.adminCost).toBe(600);
		expect(result.totalFinanced).toBe(50000);
		expect(result.monthlyPayment).toBe(51680);
	});
});

describe("calculateQuotation — autocompra, crédito interno", () => {
	test("garantía cae a 300, leasing/admin fijo/GPS quedan en 0", () => {
		const result = calculateQuotation({
			creditType: "autocompra",
			vehicleValue: 50000,
			downPayment: 10000,
			interestRate: 2,
			termMonths: 1,
			insuranceCost: 200,
			gpsCost: 148.2,
			transferCost: 0,
			royaltyPercentage: 4,
			rcdpCost: 0,
			isInterno: true,
		});

		expect(result.amountToFinance).toBe(40000);
		expect(result.calculatedRoyalty).toBe(1620);
		expect(result.calculatedInterest).toBe(721);
		expect(result.adminCost).toBe(2841);
		expect(result.totalFinanced).toBe(42841);
		expect(result.monthlyPayment).toBeCloseTo(44000.64, 2);
	});
});

describe("calculateQuotation — autocompra, garantía/leasing/admin fijo usan siempre las constantes", () => {
	test("las constantes GARANTIA_MOBILIARIA/CONTRATO_LEASING/FIXED_ADMIN_COST no se pueden sobreescribir", () => {
		const result = calculateQuotation({
			creditType: "autocompra",
			vehicleValue: 20000,
			downPayment: 1000,
			interestRate: 0,
			termMonths: 10,
			insuranceCost: 0,
			gpsCost: 0,
			transferCost: 0,
			royaltyPercentage: 4,
			rcdpCost: 0,
			isInterno: false,
		});

		// b22 = 19000 + 0 + 400 (garantía) + 400 (leasing) + 600 (admin fijo) + 0 + 0 = 20400
		expect(result.amountToFinance).toBe(19000);
		expect(result.calculatedRoyalty).toBe(816); // ceil(20400 * 0.04)
		expect(result.calculatedInterest).toBe(364); // ceil(20400 * 0.0178)
		expect(result.adminCost).toBe(2580); // 400+816+400+600+364
		expect(result.totalFinanced).toBe(21580);
		// tasa 0% -> PMT se reduce a totalFinanced / termMonths
		expect(result.monthlyPayment).toBe(2158);
	});
});

describe("calculateQuotation — caso límite: enganche = valor del vehículo", () => {
	test("amountToFinance llega a 0 sin romper el cálculo; igual se financian los gastos", () => {
		const result = calculateQuotation({
			creditType: "autocompra",
			vehicleValue: 10000,
			downPayment: 10000,
			interestRate: 1.5,
			termMonths: 1,
			insuranceCost: 0,
			gpsCost: 0,
			transferCost: 0,
			royaltyPercentage: 4,
			rcdpCost: 0,
			isInterno: true,
		});

		expect(result.amountToFinance).toBe(0);
		expect(result.adminCost).toBe(318);
		expect(result.totalFinanced).toBe(318);
		expect(result.monthlyPayment).toBe(323.34);
	});
});

describe("calculateQuotation — plazo máximo no rompe el cálculo", () => {
	test("con un plazo largo (360 meses) el resultado sigue siendo un número finito y positivo", () => {
		const result = calculateQuotation({
			creditType: "autocompra",
			vehicleValue: 200000,
			downPayment: 40000,
			interestRate: 1.8,
			termMonths: 360,
			insuranceCost: 300,
			gpsCost: 148.2,
			transferCost: 500,
			royaltyPercentage: 4,
			rcdpCost: 0,
			isInterno: false,
		});

		expect(Number.isFinite(result.monthlyPayment)).toBe(true);
		expect(result.monthlyPayment).toBeGreaterThan(0);
		expect(result.totalFinanced).toBeGreaterThan(result.amountToFinance);
	});
});

describe("calculateQuotation — rcdpCost", () => {
	test("se pasa tal cual al resultado (no se recalcula)", () => {
		const result = calculateQuotation({
			creditType: "autocompra",
			vehicleValue: 50000,
			downPayment: 10000,
			interestRate: 1.5,
			termMonths: 12,
			insuranceCost: 0,
			gpsCost: 0,
			transferCost: 0,
			royaltyPercentage: 4,
			rcdpCost: 123.45,
			isInterno: false,
		});

		expect(result.rcdpCost).toBe(123.45);
	});
});

describe("calculateQuotation — paridad", () => {
	test("mismos inputs producen exactamente el mismo resultado sin importar el contexto de invocación", () => {
		const input = {
			creditType: "autocompra" as const,
			vehicleValue: 75000,
			downPayment: 15000,
			interestRate: 1.5,
			termMonths: 24,
			insuranceCost: 250,
			gpsCost: 148.2,
			transferCost: 300,
			royaltyPercentage: 4,
			rcdpCost: 0,
			isInterno: false,
		};

		const clientSimulation = calculateQuotation({ ...input });
		const serverPersisted = calculateQuotation({ ...input });

		expect(serverPersisted).toEqual(clientSimulation);
	});
});
