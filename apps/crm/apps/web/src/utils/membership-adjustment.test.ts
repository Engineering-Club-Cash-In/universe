import { describe, expect, test } from "bun:test";
import {
	applyMembershipAdjustment,
	calculateQuotationInsuranceCosts,
	getMembershipAdjustment,
} from "./membership-adjustment";
import type { MembershipAdjustment } from "./membership-adjustment";

describe("getMembershipAdjustment", () => {
	test.each([
		[99999.99, 18.75],
		[100000, 18.75],
		[100000.01, 33.59],
		[140000, 33.59],
		[140000.01, 35],
	])("uses new personal vehicle ranges for %s", (insuredAmount, percentage) => {
		const result = getMembershipAdjustment({
			creditType: "autocompra",
			insuredAmount,
			vehicleType: "particular",
			isNew: true,
			origin: "agencia",
		});

		expect(result.category).toBe("Nuevo (sedán, SUV, pickup)");
		expect(result.percentage).toBe(percentage);
	});

	test("uses new commercial vehicle category", () => {
		const result = getMembershipAdjustment({
			creditType: "autocompra",
			insuredAmount: 100000,
			vehicleType: "microbus",
			isNew: true,
			origin: "agencia",
		});

		expect(result.category).toBe(
			"Nuevo (camión, microbus, panel, uber o similar)",
		);
		expect(result.percentage).toBe(25);
	});

	test("manual microbus without selected vehicle is treated as new commercial", () => {
		const result = getMembershipAdjustment({
			creditType: "autocompra",
			insuredAmount: 100000,
			vehicleType: "microbus",
			condition: "new",
			origin: null,
		});

		expect(result.category).toBe(
			"Nuevo (camión, microbus, panel, uber o similar)",
		);
		expect(result.percentage).toBe(25);
	});

	test("manual used microbus can be simulated as used agency", () => {
		const result = getMembershipAdjustment({
			creditType: "autocompra",
			insuredAmount: 100000,
			vehicleType: "microbus",
			condition: "used",
			origin: "agencia",
		});

		expect(result.category).toBe("Usado agencia");
		expect(result.percentage).toBe(31.25);
	});

	test("legacy Nuevo vehicle type is treated as new even with used condition", () => {
		const result = getMembershipAdjustment({
			creditType: "autocompra",
			insuredAmount: 100000,
			vehicleType: "nuevo",
			condition: "used",
			origin: "agencia",
		});

		expect(result.category).toBe("Nuevo (sedán, SUV, pickup)");
		expect(result.percentage).toBe(18.75);
	});

	test("uses used agency category from non-rodado origin", () => {
		const result = getMembershipAdjustment({
			creditType: "autocompra",
			insuredAmount: 120000,
			vehicleType: "particular",
			isNew: false,
			origin: "agencia",
		});

		expect(result.category).toBe("Usado agencia");
		expect(result.percentage).toBe(55.47);
	});

	test.each(["rodado", "importado", "subasta"])(
		"uses rodado category for origin %s",
		(origin) => {
			const result = getMembershipAdjustment({
				creditType: "autocompra",
				insuredAmount: 150000,
				vehicleType: "particular",
				isNew: false,
				origin,
			});

			expect(result.category).toBe("Rodado");
			expect(result.percentage).toBe(70);
		},
	);

	test("uses sobre vehículo category before vehicle origin", () => {
		const result = getMembershipAdjustment({
			creditType: "sobre_vehiculo",
			insuredAmount: 90000,
			vehicleType: "microbus",
			isNew: true,
			origin: "agencia",
		});

		expect(result.category).toBe("Sobre vehículo (hasta 50%)");
		expect(result.percentage).toBe(37.5);
	});
});

describe("applyMembershipAdjustment", () => {
	test("multiplies the current membership by the adjustment factor", () => {
		const result = applyMembershipAdjustment(100, {
			category: "Nuevo (sedán, SUV, pickup)",
			percentage: 18.75,
			factor: 1.1875,
		});

		expect(result).toBe(118.75);
	});

	test("adds GyT savings after the membership adjustment", () => {
		const result = applyMembershipAdjustment(
			1476.99,
			{
				category: "Nuevo (sedán, SUV, pickup)",
				percentage: 35,
				factor: 1.35,
			},
			235.18,
		);

		expect(result).toBe(2229.12);
	});
});

describe("calculateQuotationInsuranceCosts", () => {
	const adjustment: MembershipAdjustment = {
		category: "Nuevo (sedán, SUV, pickup)",
		percentage: 35,
		factor: 1.35,
	};

	test("preserves the existing Universales quotation", () => {
		expect(
			calculateQuotationInsuranceCosts({
				baseMembershipCost: 1476.99,
				customerInsuranceCost: 1360.98,
				insuranceSavingsToMembership: 0,
				gpsCost: 148.2,
				adjustment,
			}),
		).toEqual({
			customerInsuranceCost: 1360.98,
			membershipCost: 1993.94,
			netMembershipCost: 1845.74,
			insuranceCost: 3206.72,
		});
	});

	test("quotes Lucia with GyT savings added after the adjustment", () => {
		expect(
			calculateQuotationInsuranceCosts({
				baseMembershipCost: 1476.99,
				customerInsuranceCost: 1125.8,
				insuranceSavingsToMembership: 235.18,
				gpsCost: 148.2,
				adjustment,
			}),
		).toEqual({
			customerInsuranceCost: 1125.8,
			membershipCost: 2229.12,
			netMembershipCost: 2080.92,
			insuranceCost: 3206.72,
		});
	});
});
