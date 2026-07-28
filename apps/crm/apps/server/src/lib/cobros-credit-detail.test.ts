import { describe, expect, it } from "bun:test";
import {
	countRemainingInstallments,
	countScheduledPaidInstallments,
	resolveCreditContractSummary,
	resolveInstallmentAmount,
} from "./cobros-credit-detail";

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

	it("uses fallbacks without paid principal", () => {
		expect(
			resolveCreditContractSummary(
				"CANCELADO",
				[{ abono_capital: "0.00" }],
				"100.00",
				"20.00",
			),
		).toEqual({ principal: "100.00", installment: "20.00" });
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
