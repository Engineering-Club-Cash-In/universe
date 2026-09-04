import { describe, expect, test } from "bun:test";
import {
	formatMissingAssignmentsMessage,
	getMissingOpportunityAssignments,
	type OpportunityAssignmentInput,
} from "./opportunity-assignment-notice";

/** Oportunidad en el 30% con vehículo nuevo y nada asignado. */
const base: OpportunityAssignmentInput = {
	closurePercentage: 30,
	status: "open",
	vehicleId: "11111111-1111-1111-1111-111111111111",
	vehicleIsNew: true,
	companyId: null,
	vendorId: null,
};

describe("getMissingOpportunityAssignments", () => {
	test("vehículo nuevo sin nada asignado pide empresa y vendedor", () => {
		expect(getMissingOpportunityAssignments(base)).toEqual([
			"empresa",
			"vendedor",
		]);
	});

	test("vehículo nuevo con empresa solo pide vendedor", () => {
		expect(
			getMissingOpportunityAssignments({ ...base, companyId: "c1" }),
		).toEqual(["vendedor"]);
	});

	test("vehículo usado nunca pide empresa", () => {
		// Un particular no es una agencia: pedirle empresa no tiene sentido.
		expect(
			getMissingOpportunityAssignments({ ...base, vehicleIsNew: false }),
		).toEqual(["vendedor"]);
	});

	test("vehículo usado que sí tiene empresa tampoco la reclama", () => {
		expect(
			getMissingOpportunityAssignments({
				...base,
				vehicleIsNew: false,
				companyId: "c1",
			}),
		).toEqual(["vendedor"]);
	});

	test("sin vehículo asignado no pide nada todavía", () => {
		expect(
			getMissingOpportunityAssignments({ ...base, vehicleId: null }),
		).toEqual([]);
	});

	test("con todo asignado no falta nada", () => {
		expect(
			getMissingOpportunityAssignments({
				...base,
				companyId: "c1",
				vendorId: "v1",
			}),
		).toEqual([]);
	});

	test("un vendedor asignado al vehículo cuenta como fallback", () => {
		expect(
			getMissingOpportunityAssignments({
				...base,
				vendorId: null,
				vehicleVendorId: "vehicle-vendor-1",
			}),
		).toEqual(["empresa"]);
	});

	test.each([null, undefined])(
		"isNew %p se trata como usado, no reclama agencia",
		(vehicleIsNew) => {
			expect(
				getMissingOpportunityAssignments({ ...base, vehicleIsNew }),
			).toEqual(["vendedor"]);
		},
	);

	test.each([0, 20, 40, 50, 80, 85, 90, 100])(
		"en la etapa del %i%% no dice nada",
		(closurePercentage) => {
			expect(
				getMissingOpportunityAssignments({ ...base, closurePercentage }),
			).toEqual([]);
		},
	);

	test.each(["won", "lost"])(
		"una oportunidad %s ya no se reclama",
		(status) => {
			expect(getMissingOpportunityAssignments({ ...base, status })).toEqual([]);
		},
	);

	test("un id vacío cuenta como no asignado", () => {
		expect(
			getMissingOpportunityAssignments({
				...base,
				companyId: "",
				vendorId: "",
			}),
		).toEqual(["empresa", "vendedor"]);
	});
});

describe("formatMissingAssignmentsMessage", () => {
	test("sin faltantes no hay mensaje", () => {
		expect(formatMissingAssignmentsMessage([])).toBeNull();
	});

	test.each([
		[["empresa", "vendedor"], "Falta asignar la empresa (agencia) y el vendedor del vehículo"],
		[["empresa"], "Falta asignar la empresa (agencia)"],
		[["vendedor"], "Falta asignar el vendedor del vehículo"],
	] as const)("%p produce su texto", (missing, esperado) => {
		expect(formatMissingAssignmentsMessage([...missing])).toBe(esperado);
	});
});
