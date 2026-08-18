import { describe, expect, test } from "bun:test";
import {
	buildServerInsurancePersistence,
	normalizeInsuranceBreakdown,
	selectInsuranceProvider,
} from "./insurance-selection";

describe("selectInsuranceProvider", () => {
	test("keeps Universales for eligible vehicle at Q257,000 or below", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 257000,
			vehicleType: "particular",
			universalesCost: 582.76,
			gytCost: 500,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
		expect(result.customerInsuranceCost).toBe(582.76);
		expect(result.insuranceSavingsToMembership).toBe(0);
	});

	test.each([
		"particular",
		"nuevo",
	])("uses GyT for eligible type %s over Q257,000 when cheaper", (vehicleType) => {
		const result = selectInsuranceProvider({
			insuredAmount: 257000.01,
			vehicleType,
			universalesCost: 585.86,
			gytCost: 584.96,
			membershipCost: 100,
		});

		expect(result.provider).toBe("gyt");
		expect(result.customerInsuranceCost).toBe(585.86);
		expect(result.internalInsuranceCost).toBe(584.96);
		expect(result.insuranceSavingsToMembership).toBeCloseTo(0.9, 2);
		expect(result.effectiveMembershipCost).toBeCloseTo(100.9, 2);
	});

	test.each([
		"uber",
		"pickup",
		"microbus",
		"microbus_20",
		"microbus_35",
		"microbus_36plus",
	])("keeps Universales for excluded type %s even when over threshold and cheaper", (vehicleType) => {
		const result = selectInsuranceProvider({
			insuredAmount: 300000,
			vehicleType,
			universalesCost: 900,
			gytCost: 700,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
	});

	test("never uses GyT for pickup", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 300000,
			vehicleType: "pickup",
			universalesCost: 900,
			gytCost: 700,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
	});

	test.each([
		"panel",
		"camion",
		"otro",
	])("keeps Universales for non-approved type %s", (vehicleType) => {
		const result = selectInsuranceProvider({
			insuredAmount: 300000,
			vehicleType,
			universalesCost: 900,
			gytCost: 700,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
	});

	test("keeps Universales in the approved range when GyT is NOT cheaper", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 300000,
			vehicleType: "particular",
			universalesCost: 584,
			gytCost: 585,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
		expect(result.customerInsuranceCost).toBe(584);
		expect(result.internalInsuranceCost).toBe(584);
		expect(result.insuranceSavingsToMembership).toBe(0);
	});
});

describe("normalizeInsuranceBreakdown", () => {
	test("returns DB-safe values for GyT selection", () => {
		const result = normalizeInsuranceBreakdown({
			selection: selectInsuranceProvider({
				insuredAmount: 300000,
				vehicleType: "particular",
				universalesCost: 585.86,
				gytCost: 584.96,
				membershipCost: 100,
			}),
		});

		expect(result.insuranceProvider).toBe("gyt");
		expect(result.seguro).toBe("585.86");
		expect(result.membresiaPago).toBe("100.90");
	});

	test("returns DB-safe values for Universales selection", () => {
		const result = normalizeInsuranceBreakdown({
			selection: selectInsuranceProvider({
				insuredAmount: 257000,
				vehicleType: "particular",
				universalesCost: 582.76,
				gytCost: 583.3,
				membershipCost: 100,
			}),
		});

		expect(result.insuranceProvider).toBe("universales");
		expect(result.seguro).toBe("582.76");
		expect(result.membresiaPago).toBe("100.00");
	});
});

describe("buildServerInsurancePersistence", () => {
	test("preserves the web quoter's adjusted membership without adding GyT savings again", () => {
		const result = buildServerInsurancePersistence({
			insuredAmount: 300000,
			vehicleType: "particular",
			universalesCost: 600,
			gytCost: 580,
			// The web quoter already adjusted the base + GyT saving for the
			// condition/origin/credit type, then subtracted GPS for the net
			// membership that is shown and saved.
			membershipCost: 691.8,
			customerInsuranceCost: 1291.8,
		});

		expect(result.insuranceProvider).toBe("gyt");
		expect(result.insuranceSavingsToMembership).toBe("20.00");
		expect(result.membresiaPago).toBe("691.80");
	});

	test("ignores manipulated client breakdown while preserving submitted effective membership", () => {
		const result = buildServerInsurancePersistence({
			insuredAmount: 300000,
			vehicleType: "particular",
			universalesCost: 585.86,
			gytCost: 584.96,
			membershipCost: 100.9,
			clientBreakdown: {
				insuranceProvider: "universales",
				customerInsuranceCost: 1,
				internalInsuranceCost: 1,
				insuranceSavingsToMembership: 999,
			},
		});

		expect(result.insuranceProvider).toBe("gyt");
		expect(result.seguro).toBe("585.86");
		expect(result.customerInsuranceCost).toBe("585.86");
		expect(result.internalInsuranceCost).toBe("584.96");
		expect(result.insuranceSavingsToMembership).toBe("0.90");
		expect(result.membresiaPago).toBe("100.90");
	});

	test("uses visible quoter insurance as customer amount when provided", () => {
		const result = buildServerInsurancePersistence({
			insuredAmount: 300000,
			vehicleType: "particular",
			universalesCost: 550.1,
			gytCost: 540,
			membershipCost: 403.32,
			customerInsuranceCost: 953.42,
		});

		expect(result.insuranceProvider).toBe("gyt");
		expect(result.seguro).toBe("953.42");
		expect(result.customerInsuranceCost).toBe("953.42");
		expect(result.internalInsuranceCost).toBe("540.00");
		// ahorro limpio = universales - gyt = 550.10 - 540 = 10.10 (no del bundle)
		expect(result.insuranceSavingsToMembership).toBe("10.10");
		// membresía efectiva = la membresía visible/ajustada recibida, sin sumar
		// nuevamente el ahorro GyT.
		expect(result.membresiaPago).toBe("403.32");
	});

	test("does not derive membership from the customer insurance bundle", () => {
		// customerInsuranceCost puede traer el bundle visible, pero el ahorro sale
		// únicamente de Universales - GyT y la membresía se conserva desde el campo
		// explícito del cotizador.
		const result = buildServerInsurancePersistence({
			insuredAmount: 300000,
			vehicleType: "particular",
			universalesCost: 600,
			gytCost: 580,
			membershipCost: 162,
			customerInsuranceCost: 762,
		});

		expect(result.insuranceProvider).toBe("gyt");
		// ahorro = universales - gyt = 20 (NO 762 - 580 = 182)
		expect(result.insuranceSavingsToMembership).toBe("20.00");
		expect(result.membresiaPago).toBe("162.00");
	});
});
