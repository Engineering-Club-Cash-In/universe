import { describe, expect, test } from "bun:test";
import { hasStaleAnalysisChecklistVehicle } from "./analysis-checklist";

describe("analysis checklist helpers", () => {
	test("detects stale checklist vehicle ids", () => {
		expect(
			hasStaleAnalysisChecklistVehicle(
				{
					sections: {
						vehiculo: {
							vehicleId: "old-vehicle-id",
						},
					},
				},
				"current-vehicle-id",
			),
		).toBe(true);
	});

	test("treats matching checklist vehicle ids as fresh", () => {
		expect(
			hasStaleAnalysisChecklistVehicle(
				{
					sections: {
						vehiculo: {
							vehicleId: "same-vehicle-id",
						},
					},
				},
				"same-vehicle-id",
			),
		).toBe(false);
	});

	test("treats null vehicle ids consistently", () => {
		expect(hasStaleAnalysisChecklistVehicle(undefined, undefined)).toBe(false);
		expect(
			hasStaleAnalysisChecklistVehicle(
				{
					sections: {
						vehiculo: {
							vehicleId: null,
						},
					},
				},
				null,
			),
		).toBe(false);
	});
});
