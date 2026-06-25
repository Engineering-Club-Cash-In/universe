import { describe, expect, test } from "bun:test";
import { getStageVehicleRequirementError } from "./opportunity-stage-guard";

describe("opportunity stage vehicle guard", () => {
	test("requires a vehicle when moving from 30% to a later stage", () => {
		expect(getStageVehicleRequirementError(30, 40, null)).toBe(
			"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado.",
		);
	});

	test("keeps the existing requirement when moving from 20% to 30%", () => {
		expect(getStageVehicleRequirementError(20, 30, undefined)).toBe(
			"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado.",
		);
	});

	test("allows stage changes when a vehicle is assigned", () => {
		expect(getStageVehicleRequirementError(30, 40, "vehicle-id")).toBeNull();
	});
});
