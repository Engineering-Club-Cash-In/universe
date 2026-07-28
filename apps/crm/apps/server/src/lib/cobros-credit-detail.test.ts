import { describe, expect, it } from "bun:test";
import { countScheduledPaidInstallments } from "./cobros-credit-detail";

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
