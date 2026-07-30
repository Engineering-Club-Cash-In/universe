import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
	countRemainingInstallments,
	countScheduledPaidInstallments,
	resolveCreditContractSummary,
	resolveHistoricalInstallment,
	resolveInstallmentAmount,
	resolveOperationalInstallment,
} from "./cobros-credit-detail";

describe("resolveOperationalInstallment", () => {
	it("zeros cancelled installments", () => {
		expect(resolveOperationalInstallment("CANCELADO", "2323.10")).toBe("0.00");
	});

	it("preserves active installments", () => {
		expect(resolveOperationalInstallment("ACTIVO", "2323.10")).toBe("2323.10");
	});

	it("keeps the historical amount limited to the contractual display", async () => {
		const [routerSource, detailSource] = await Promise.all([
			Bun.file(resolve(import.meta.dir, "../routers/cobros.ts")).text(),
			Bun.file(
				resolve(import.meta.dir, "../../../web/src/routes/cobros/$id.tsx"),
			).text(),
		]);

		expect(routerSource).toMatch(
			/cuotaMensual:\s*resolveOperationalInstallment\(\s*statusCredit,\s*contractSummary\.installment,?\s*\)/,
		);
		expect(routerSource).toContain(
			"cuotaMensualHistorica: contractSummary.installment",
		);
		expect(routerSource).toContain("resolveHistoricalInstallment(");
		expect(routerSource).not.toContain(
			"creditoCompleto.credito.cuota || oportunidadData?.cuotaMensual",
		);
		expect(detailSource.match(/caso\.cuotaMensualHistorica/g)).toHaveLength(2);
		expect(detailSource).toContain(
			"caso.cuotaMensualHistorica ?? caso.cuotaMensual",
		);
	});
});

describe("resolveHistoricalInstallment", () => {
	it("uses the cartera installment only when it is positive", () => {
		expect(resolveHistoricalInstallment("2323.10", "1900.00")).toBe("2323.10");
		expect(resolveHistoricalInstallment("0.00", "1900.00")).toBe("1900.00");
		expect(resolveHistoricalInstallment(null, "1900.00")).toBe("1900.00");
	});
});

describe("resolveCreditContractSummary", () => {
	it("preserves active fallbacks", () => {
		expect(
			resolveCreditContractSummary(
				"ACTIVO",
				[{ abono_capital: "9.99" }],
				"100.00",
				"20.00",
			),
		).toEqual({ principal: "100.00", installment: "20.00" });
	});

	it("reconstructs cancelled contract values", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[
					{ abono_capital: "30000.08", cuota: "2200.00" },
					{
						abono_capital: "21875.00",
						cuota: "2323.10",
						validationStatus: "reset",
					},
				],
				"0.00",
				"0.00",
			),
		).toEqual({ principal: "51875.08", installment: "2323.10" });
	});

	it("returns no principal without paid principal or reset evidence", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[{ abono_capital: "0.00" }],
				"100.00",
				"20.00",
			),
		).toEqual({ principal: null, installment: "20.00" });
	});

	it("prefers an authoritative cancelled summary including off-schedule capital", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[{ abono_capital: "30000.00", cuota: "2200.00" }],
				"0.00",
				"0.00",
				{ originalPrincipal: "51875.08", installment: "2323.10" },
			),
		).toEqual({ principal: "51875.08", installment: "2323.10" });
	});

	it("falls back to paid rows when authoritative values are zero", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[
					{
						abono_capital: "30000.00",
						cuota: "2200.00",
						validationStatus: "reset",
					},
				],
				"0.00",
				"0.00",
				{ originalPrincipal: "0.00", installment: "0" },
			),
		).toEqual({ principal: "30000.00", installment: "2200.00" });
	});

	it("returns no principal for a validated partial payment without reset evidence", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[
					{
						abono_capital: "30000.00",
						cuota: "2200.00",
						validationStatus: "validated",
					},
				],
				"51875.08",
				"2323.10",
			),
		).toEqual({ principal: null, installment: "2323.10" });
	});

	it("preserves an authoritative null instead of reconstructing principal", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[
					{
						abono_capital: "30000.00",
						cuota: "2200.00",
						validationStatus: "reset",
					},
				],
				"0.00",
				"0.00",
				{ originalPrincipal: null, installment: "2200.00" },
			),
		).toEqual({ principal: null, installment: "2200.00" });
	});
});

describe("countRemainingInstallments", () => {
	it("returns zero for cancelled contracts", () => {
		expect(
			countRemainingInstallments("CANCELADO", 48, Array(22).fill({}), true),
		).toBe(0);
	});

	it("preserves the active formula and clamps at zero", () => {
		expect(
			countRemainingInstallments("ACTIVO", 48, Array(22).fill({}), true),
		).toBe(27);
		expect(
			countRemainingInstallments("ACTIVO", 10, Array(22).fill({}), false),
		).toBe(0);
	});
});

describe("resolveInstallmentAmount", () => {
	it("prefers the row amount, including zero", () => {
		expect(resolveInstallmentAmount("125.50", "200.00")).toBe("125.50");
		expect(resolveInstallmentAmount("0", "200.00")).toBe("0");
	});

	it("falls back to the current credit amount", () => {
		expect(resolveInstallmentAmount(null, "200.00")).toBe("200.00");
		expect(resolveInstallmentAmount(undefined, "200.00")).toBe("200.00");
	});
});

describe("countScheduledPaidInstallments", () => {
	it("excludes only reset payments", () => {
		expect(
			countScheduledPaidInstallments([
				{ validationStatus: "validated" },
				{ validationStatus: "pending" },
				{ validationStatus: null },
				{ validationStatus: "reset" },
			]),
		).toBe(3);
	});

	it("returns zero without rows", () => {
		expect(countScheduledPaidInstallments(null)).toBe(0);
		expect(countScheduledPaidInstallments(undefined)).toBe(0);
	});
});
