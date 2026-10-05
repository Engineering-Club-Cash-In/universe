import { describe, expect, test } from "bun:test";
import {
	carryForwardAnalysisChecklistVerificationState,
	hasStaleAnalysisChecklistDocumentState,
	hasStaleAnalysisChecklistVehicleState,
} from "./analysis-checklist";
import {
	type ChecklistData,
	rebuildClientDocumentChecklistData,
} from "./checklist";

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

	test("preserves manual verification state when regenerating checklist", () => {
		const nextChecklistData = {
			sections: {
				verificaciones: {
					items: [
						{
							type: "confirmacion_referencias",
							completed: false,
						},
					],
				},
				vehiculo: {
					verificaciones: {
						items: [
							{
								type: "consulta_rgm",
								completed: false,
							},
						],
					},
				},
			},
		};

		carryForwardAnalysisChecklistVerificationState(nextChecklistData, {
			sections: {
				verificaciones: {
					items: [
						{
							type: "confirmacion_referencias",
							completed: true,
							verifiedBy: "analyst-1",
							verifiedAt: "2026-05-26T17:00:00.000Z",
						},
					],
				},
				vehiculo: {
					verificaciones: {
						items: [
							{
								type: "consulta_rgm",
								completed: true,
								verifiedBy: "analyst-2",
								verifiedAt: "2026-05-26T17:05:00.000Z",
							},
						],
					},
				},
			},
		});

		expect(nextChecklistData.sections.verificaciones.items[0]).toMatchObject({
			completed: true,
			verifiedBy: "analyst-1",
			verifiedAt: "2026-05-26T17:00:00.000Z",
		});
		expect(
			nextChecklistData.sections.vehiculo.verificaciones.items[0],
		).toMatchObject({
			completed: true,
			verifiedBy: "analyst-2",
			verifiedAt: "2026-05-26T17:05:00.000Z",
		});
	});

	test("automatic and manual cleanup-debt rows never satisfy uploaded or canApprove", () => {
		const checklist: ChecklistData = {
			sections: {
				documentos: {
					items: [
						{
							documentType: "estados_cuenta_1",
							required: true,
							uploaded: false,
						},
					],
					completed: false,
				},
				verificaciones: { items: [], completed: true },
			},
			overallProgress: 0,
			canApprove: false,
		};
		rebuildClientDocumentChecklistData(
			checklist,
			[
				{
					id: "debt-row",
					documentType: "estados_cuenta_1",
					description:
						"[bank-coverage-debt:batch-1:artifact:debt-row:file:0]",
				},
				{
					id: "manual-debt-row",
					documentType: "estados_cuenta_1",
					description:
						"[manual-bank-debt:delete_cleanup:actor:user-1:type:estados_cuenta_1]",
				},
			],
			false,
		);
		expect(checklist.sections.documentos.items[0].uploaded).toBe(false);
		expect(checklist.sections.documentos.completed).toBe(false);
		expect(checklist.canApprove).toBe(false);
	});
});
