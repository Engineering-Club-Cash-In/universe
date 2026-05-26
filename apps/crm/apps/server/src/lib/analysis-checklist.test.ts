import { describe, expect, test } from "bun:test";
import {
	hasStaleAnalysisChecklistDocumentState,
	hasStaleAnalysisChecklistVehicleState,
} from "./analysis-checklist";

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

	test("detects stale client document upload state", () => {
		expect(
			hasStaleAnalysisChecklistDocumentState(
				{
					sections: {
						documentos: {
							items: [
								{
									documentType: "estados_cuenta_1",
									uploaded: true,
								},
								{
									documentType: "estados_cuenta_2",
									uploaded: false,
								},
								{
									documentType: "estados_cuenta_3",
									uploaded: false,
								},
							],
						},
					},
				},
				new Set([
					"estados_cuenta_1",
					"estados_cuenta_2",
					"estados_cuenta_3",
				]),
				new Set(),
			),
		).toBe(true);
	});

	test("treats matching client and vehicle document states as fresh", () => {
		expect(
			hasStaleAnalysisChecklistDocumentState(
				{
					sections: {
						documentos: {
							items: [
								{
									documentType: "dpi",
									uploaded: true,
								},
							],
						},
						vehiculo: {
							documentos: {
								items: [
									{
										documentType: "tarjeta_circulacion",
										uploaded: true,
									},
								],
							},
						},
					},
				},
				new Set(["dpi"]),
				new Set(["tarjeta_circulacion"]),
			),
		).toBe(false);
	});
});
