import { describe, expect, test } from "bun:test";
import {
	applyMembershipAdjustment,
	getMembershipAdjustment,
} from "./membership-adjustment";

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
});
