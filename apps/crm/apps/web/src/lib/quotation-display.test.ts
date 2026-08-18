import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DISBURSEMENT_SALE_LABEL,
	formatQuotationClientName,
	formatVehicleWithClient,
} from "./quotation-display";

describe("quotation display helpers", () => {
	test("formats lead names for quotation client display", () => {
		expect(
			formatQuotationClientName({
				leadFirstName: "Ana",
				leadLastName: "López",
				companyName: null,
			}),
		).toBe("Ana López");
	});

	test("uses company name when no lead name is available", () => {
		expect(
			formatQuotationClientName({
				leadFirstName: null,
				leadLastName: null,
				companyName: "ACME, S.A.",
			}),
		).toBe("ACME, S.A.");
	});

	test("adds client name to vehicle labels", () => {
		expect(formatVehicleWithClient("Toyota Hilux 2022", "Ana López")).toBe(
			"Toyota Hilux 2022 - Ana López",
		);
	});

	test("renames inspection line item label", () => {
		expect(DISBURSEMENT_SALE_LABEL).toBe("Desembolso por venta");
	});

	test("does not render the GyT internal insurance detail in the quoter", () => {
		const quoterSource = readFileSync(
			join(import.meta.dir, "../routes/crm/quoter.tsx"),
			"utf8",
		);

		expect(quoterSource).not.toContain("Seguro: GyT. Actual Excel");
		expect(quoterSource).not.toContain("Diferencia a membresía");
	});
});
