import { describe, expect, test } from "bun:test";
import {
	DISBURSEMENT_SALE_LABEL,
	formatInsuranceProviderLabel,
	formatQuotationClientName,
	formatVehicleWithClient,
	getQuotationInsuranceFieldName,
	getQuotationInsuranceDisplay,
	isQuotationInsuranceBreakdownLocked,
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

	test("shows the GyT provider label in the quoter", () => {
		expect(formatInsuranceProviderLabel("gyt")).toBe("Seguro: GyT");
	});

	test("keeps the Universales provider label in the quoter", () => {
		expect(formatInsuranceProviderLabel("universales")).toBe(
			"Seguro: Universales",
		);
	});

	test("uses GyT visible costs when GyT is selected", () => {
		expect(
			getQuotationInsuranceDisplay({
				insuranceProvider: "gyt",
				insuranceCost: 3206.72,
				membershipCost: 2080.92,
				extraInsuranceCost: 1125.8,
				extraMembershipCost: 2229.12,
			}),
		).toEqual({
			insuranceProvider: "gyt",
			insuranceCost: 1125.8,
			membershipCost: 2229.12,
		});
	});

	test("preserves existing Universales costs", () => {
		expect(
			getQuotationInsuranceDisplay({
				insuranceProvider: "universales",
				insuranceCost: 3206.72,
				membershipCost: 1845.74,
				extraInsuranceCost: 1360.98,
				extraMembershipCost: 1993.94,
			}),
		).toEqual({
			insuranceProvider: "universales",
			insuranceCost: 3206.72,
			membershipCost: 1845.74,
		});
	});

	test("keeps the Universales form bound to its existing insurance field", () => {
		expect(getQuotationInsuranceFieldName("universales")).toBe("insuranceCost");
	});

	test("binds the GyT form to the visible provider cost", () => {
		expect(getQuotationInsuranceFieldName("gyt")).toBe("extraInsuranceCost");
	});

	test("locks the calculated GyT breakdown", () => {
		expect(isQuotationInsuranceBreakdownLocked("gyt")).toBe(true);
	});

	test("preserves editable and optional Universales breakdown", () => {
		expect(isQuotationInsuranceBreakdownLocked("universales")).toBe(false);
	});
});
