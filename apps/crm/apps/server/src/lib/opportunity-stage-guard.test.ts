import { describe, expect, test } from "bun:test";
import {
	getStageLeadRequirementError,
	getStageVehicleRequirementError,
	resolveOpportunityUpdateVersion,
} from "./opportunity-stage-guard";

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

describe("opportunity stage lead guard", () => {
	test("rejects clearing the lead from an opportunity already in contractual workflow", () => {
		expect(getStageLeadRequirementError(85, null)).toBe(
			"La oportunidad debe conservar un cliente asignado desde la etapa jurídica (80%).",
		);
	});

	test("requires an effective lead when entering contractual workflow", () => {
		expect(getStageLeadRequirementError(80, null)).toBe(
			"La oportunidad debe conservar un cliente asignado desde la etapa jurídica (80%).",
		);
	});

	test("allows clearing the lead before contractual workflow", () => {
		expect(getStageLeadRequirementError(79, null)).toBeNull();
	});

	test("allows advanced-stage edits when a lead remains assigned", () => {
		expect(getStageLeadRequirementError(90, "lead-id")).toBeNull();
	});
});

describe("opportunity update concurrency guard", () => {
	test("uses the server snapshot when the client omits optimistic locking", () => {
		const snapshot = new Date("2026-08-27T08:00:00.000Z");

		expect(resolveOpportunityUpdateVersion(snapshot)).toEqual(snapshot);
	});

	test("preserves an explicit client version", () => {
		const snapshot = new Date("2026-08-27T08:00:00.000Z");

		expect(
			resolveOpportunityUpdateVersion(snapshot, "2026-08-27T07:59:00.000Z"),
		).toEqual(new Date("2026-08-27T07:59:00.000Z"));
	});
});
