import { describe, expect, it } from "bun:test";
import {
	countScheduledPaidInstallments,
	resolveInstallmentAmount,
} from "./cobros-credit-detail";

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
