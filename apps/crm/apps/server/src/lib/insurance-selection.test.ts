import { describe, expect, test } from "bun:test";
import {
	buildServerInsurancePersistence,
	normalizeInsuranceBreakdown,
	selectInsuranceProvider,
} from "./insurance-selection";

describe("selectInsuranceProvider", () => {
	test("keeps Universales for particular below Q189,000", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 188000,
			vehicleType: "particular",
			universalesCost: 582.76,
			gytCost: 583.3,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
		expect(result.customerInsuranceCost).toBe(582.76);
		expect(result.insuranceSavingsToMembership).toBe(0);
	});

	test("uses GyT for particular from Q189,000 when cheaper", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 189000,
			vehicleType: "particular",
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
		"particular",
		"uber",
		"nuevo",
	])("uses GyT for %s from Q189,000 when cheaper", (vehicleType) => {
		const result = selectInsuranceProvider({
			insuredAmount: 189000,
			vehicleType,
			universalesCost: 585.86,
			gytCost: 584.96,
			membershipCost: 100,
		});

		expect(result.provider).toBe("gyt");
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

	test("keeps Universales for microbus below Q125,000", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 124000,
			vehicleType: "microbus",
			universalesCost: 776.51,
			gytCost: 778.34,
			membershipCost: 100,
		});

		expect(result.provider).toBe("universales");
	});

	test("uses GyT for microbus from Q125,000 when cheaper", () => {
		const result = selectInsuranceProvider({
			insuredAmount: 125000,
			vehicleType: "microbus",
			universalesCost: 782.78,
			gytCost: 781.78,
			membershipCost: 100,
		});

		expect(result.provider).toBe("gyt");
		expect(result.customerInsuranceCost).toBe(782.78);
		expect(result.insuranceSavingsToMembership).toBeCloseTo(1, 2);
	});

	test.each([
		"microbus",
		"microbus_20",
		"microbus_35",
		"microbus_36plus",
	])("uses GyT for %s from Q125,000 when cheaper", (vehicleType) => {
		const result = selectInsuranceProvider({
			insuredAmount: 125000,
			vehicleType,
			universalesCost: 782.78,
			gytCost: 781.78,
			membershipCost: 100,
		});

		expect(result.provider).toBe("gyt");
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
			insuredAmount: 189000,
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
				insuredAmount: 189000,
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
				insuredAmount: 188000,
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
	test("ignores manipulated client breakdown and persists server-calculated values", () => {
		const result = buildServerInsurancePersistence({
			insuredAmount: 189000,
			vehicleType: "particular",
			universalesCost: 585.86,
			gytCost: 584.96,
			membershipCost: 100,
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
		// El server ya no re-suma el ahorro a la membresía (lo hace el front una vez).
		expect(result.membresiaPago).toBe("100.00");
	});

	test("uses visible quoter insurance as customer amount when provided", () => {
		const result = buildServerInsurancePersistence({
			insuredAmount: 189000,
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
		// membresía = la que mandó el front, sin re-sumar el ahorro
		expect(result.membresiaPago).toBe("403.32");
	});

	test("computes savings from insurance prices and does not re-add them to membership", () => {
		// El front ya metió el ahorro GyT en membershipCost (162) y armó el bundle
		// base + membresía en customerInsuranceCost (762). El server NO debe calcular
		// el ahorro del bundle (762-580) ni volver a sumarlo a la membresía.
		const result = buildServerInsurancePersistence({
			insuredAmount: 189000,
			vehicleType: "particular",
			universalesCost: 600,
			gytCost: 580,
			membershipCost: 162,
			customerInsuranceCost: 762,
		});

		expect(result.insuranceProvider).toBe("gyt");
		// ahorro = universales - gyt = 20  (NO 762 - 580 = 182)
		expect(result.insuranceSavingsToMembership).toBe("20.00");
		// membresía persistida = la que mandó el front, sin re-sumar el ahorro
		expect(result.membresiaPago).toBe("162.00");
	});
});
