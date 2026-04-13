import { describe, expect, test } from "bun:test";
import { hasStaleAnalysisChecklistVehicleState } from "./analysis-checklist";

describe("analysis checklist helpers", () => {
	test("detects stale checklist vehicle ids", () => {
		expect(
			hasStaleAnalysisChecklistVehicleState(
				{
					sections: {
						vehiculo: {
							vehicleId: "old-vehicle-id",
							inspected: true,
						},
					},
				},
				"current-vehicle-id",
				true,
			),
		).toBe(true);
	});

	test("treats matching checklist vehicle ids as fresh", () => {
		expect(
			hasStaleAnalysisChecklistVehicleState(
				{
					sections: {
						vehiculo: {
							vehicleId: "same-vehicle-id",
							inspected: true,
						},
					},
				},
				"same-vehicle-id",
				true,
			),
		).toBe(false);
	});

	test("treats null vehicle ids consistently", () => {
		expect(
			hasStaleAnalysisChecklistVehicleState(undefined, undefined, false),
		).toBe(false);
		expect(
			hasStaleAnalysisChecklistVehicleState(
				{
					sections: {
						vehiculo: {
							vehicleId: null,
							inspected: false,
						},
					},
				},
				null,
				false,
			),
		).toBe(false);
	});

	test("detects stale inspection approval state for the same vehicle", () => {
		expect(
			hasStaleAnalysisChecklistVehicleState(
				{
					sections: {
						vehiculo: {
							vehicleId: "same-vehicle-id",
							inspected: false,
						},
					},
				},
				"same-vehicle-id",
				true,
			),
		).toBe(true);
	});
});
