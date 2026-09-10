import { describe, expect, test } from "bun:test";
import {
	canApproveDocumentIntegrityValidation,
	canViewDocumentIntegrityValidationDetail,
	getAttemptAvailability,
	getAttemptStatus,
	getManualApprovalAvailability,
	getPendingManualApprovalCount,
	getRejectedDocumentCount,
	getResetAvailability,
	isCompleteValidationRun,
	uploadedValidationPairsMatch,
} from "./workflow-policy";

describe("document integrity workflow policy", () => {
	test("el detalle solo admite roles de análisis y ventas", () => {
		for (const role of ["admin", "analyst", "sales_supervisor", "sales"])
			expect(canViewDocumentIntegrityValidationDetail(role)).toBe(true);
		for (const role of [
			"juridico",
			"accounting",
			"cobros",
			"cobros_supervisor",
		])
			expect(canViewDocumentIntegrityValidationDetail(role)).toBe(false);
	});

	test("solo administradores y supervisores de ventas pueden aprobar", () => {
		expect(canApproveDocumentIntegrityValidation("admin")).toBe(true);
		expect(canApproveDocumentIntegrityValidation("sales_supervisor")).toBe(
			true,
		);
		for (const role of ["sales", "analyst", "juridico", "accounting"]) {
			expect(canApproveDocumentIntegrityValidation(role)).toBe(false);
		}
	});

	test("cuenta únicamente revisiones manuales sin aprobación", () => {
		expect(
			getPendingManualApprovalCount([
				{ autoResult: "valido", manualApprovalId: null },
				{ autoResult: "revision_manual", manualApprovalId: null },
				{ autoResult: "revision_manual", manualApprovalId: "approval-1" },
				{ autoResult: "rechazado", manualApprovalId: null },
				{ autoResult: "rechazado", manualApprovalId: "approval-2" },
			]),
		).toBe(1);
		expect(
			getRejectedDocumentCount([
				{ autoResult: "revision_manual" },
				{ autoResult: "rechazado" },
				{ autoResult: "rechazado" },
			]),
		).toBe(2);
	});

	test("solo permite aprobar revisión manual de la ejecución vigente", () => {
		const current = {
			autoResult: "revision_manual",
			validationRunId: "run-2",
			runStatus: "completed" as const,
			attemptNumber: 2,
			resetAfterAttemptNumber: 0,
			latestRunId: "run-2",
			latestRunStatus: "completed" as const,
		};
		expect(getManualApprovalAvailability(current)).toEqual({ allowed: true });
		expect(
			getManualApprovalAvailability({ ...current, autoResult: "rechazado" }),
		).toEqual({ allowed: false, reason: "wrong_result" });
		expect(
			getManualApprovalAvailability({ ...current, autoResult: "valido" }),
		).toEqual({ allowed: false, reason: "wrong_result" });
		expect(
			getManualApprovalAvailability({ ...current, latestRunId: "run-3" }),
		).toEqual({ allowed: false, reason: "stale_run" });
		expect(
			getManualApprovalAvailability({
				...current,
				latestRunStatus: "error",
			}),
		).toEqual({ allowed: false, reason: "stale_run" });
		expect(
			getManualApprovalAvailability({
				...current,
				resetAfterAttemptNumber: 2,
			}),
		).toEqual({ allowed: false, reason: "stale_run" });
	});
	test("permite exactamente dos intentos y bloquea el tercero", () => {
		expect(
			getAttemptAvailability({
				latestAttempt: 0,
				completedAttempts: 0,
				runsInCycle: 0,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: true, nextAttempt: 1 });
		expect(
			getAttemptAvailability({
				latestAttempt: 1,
				completedAttempts: 1,
				runsInCycle: 1,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: true, nextAttempt: 2 });
		expect(
			getAttemptAvailability({
				latestAttempt: 2,
				completedAttempts: 2,
				runsInCycle: 2,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: false, reason: "limit", nextAttempt: 3 });
	});

	test("las ejecuciones fallidas no gastan cupo pero tienen techo de costo", () => {
		// Cinco fallidas: el cupo sigue intacto porque ninguna completo.
		expect(
			getAttemptAvailability({
				latestAttempt: 5,
				completedAttempts: 0,
				runsInCycle: 5,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: true, nextAttempt: 6 });
		// La sexta agota el techo: sin el, repetir un lote invalido daria analisis
		// pagados ilimitados sin consumir intentos.
		expect(
			getAttemptAvailability({
				latestAttempt: 6,
				completedAttempts: 0,
				runsInCycle: 6,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: false, reason: "cost_cap", nextAttempt: 7 });
		// El cupo manda sobre el techo cuando ambos aplican.
		expect(
			getAttemptAvailability({
				latestAttempt: 6,
				completedAttempts: 2,
				runsInCycle: 6,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: false, reason: "limit", nextAttempt: 7 });
	});

	test("solo un lote íntegro puede marcarse completado y reutilizarse", () => {
		expect(
			isCompleteValidationRun(
				[
					{ validation: { autoResult: "valido" } },
					{ validation: { autoResult: "revision_manual" } },
				],
				2,
			),
		).toBe(true);
		expect(
			isCompleteValidationRun(
				[{ validation: { autoResult: "valido" } }, { validation: null }],
				2,
			),
		).toBe(false);
		expect(
			isCompleteValidationRun(
				[
					{ validation: { autoResult: "valido" } },
					{ validation: { autoResult: "error" } },
				],
				2,
			),
		).toBe(false);
	});

	test("un intento técnico fallido no consume cupo pero conserva la secuencia", () => {
		expect(
			getAttemptAvailability({
				latestAttempt: 2,
				completedAttempts: 1,
				runsInCycle: 1,
				maxRunsPerCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: true, nextAttempt: 3 });
	});

	test("un reinicio abre un ciclo nuevo sin borrar las ejecuciones anteriores", () => {
		const now = Date.UTC(2026, 8, 4, 12);
		const status = getAttemptStatus({
			runs: [
				{
					attemptNumber: 1,
					status: "completed",
					startedAt: new Date(now - 300_000),
				},
				{
					attemptNumber: 2,
					status: "completed",
					startedAt: new Date(now - 200_000),
				},
				{
					attemptNumber: 3,
					status: "error",
					startedAt: new Date(now - 100_000),
				},
			],
			resetAfterAttemptNumber: 2,
			maxAttempts: 2,
			staleAfterMs: 180_000,
			now,
		});

		expect(status).toMatchObject({
			attemptCount: 0,
			remainingAttempts: 2,
			canValidate: true,
		});
	});

	test("el reset exige cupo agotado, bloquea ejecuciones activas y usa el último correlativo", () => {
		expect(
			getResetAvailability({
				latestAttempt: 4,
				completedAttempts: 2,
				hasProcessingRun: true,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: false, reason: "processing" });
		expect(
			getResetAvailability({
				latestAttempt: 4,
				completedAttempts: 1,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: false, reason: "quota_available" });
		expect(
			getResetAvailability({
				latestAttempt: 7,
				completedAttempts: 2,
				hasProcessingRun: false,
				maxAttempts: 2,
			}),
		).toEqual({ allowed: true, resetAfterAttemptNumber: 7 });
	});

	test("el tope de ejecuciones fallidas permite reiniciar el ciclo", () => {
		expect(
			getResetAvailability({
				latestAttempt: 6,
				completedAttempts: 0,
				runsInCycle: 6,
				hasProcessingRun: false,
				maxAttempts: 2,
				maxRunsPerCycle: 6,
			}),
		).toEqual({ allowed: true, resetAfterAttemptNumber: 6 });
	});

	test("el tope de ejecuciones fallidas bloquea validar hasta reiniciar", () => {
		const now = Date.UTC(2026, 8, 4, 12);
		const status = getAttemptStatus({
			runs: Array.from({ length: 6 }, (_, index) => ({
				attemptNumber: index + 1,
				status: "error" as const,
				startedAt: new Date(now - (index + 1) * 60_000),
			})),
			maxAttempts: 2,
			maxRunsPerCycle: 6,
			staleAfterMs: 180_000,
			now,
		});

		expect(status).toMatchObject({
			attemptCount: 0,
			remainingAttempts: 2,
			canValidate: false,
			costCapReached: true,
		});
	});

	test("bloquea una ejecución concurrente y libera una ejecución obsoleta", () => {
		const now = Date.UTC(2026, 8, 4, 12);
		const active = getAttemptStatus({
			runs: [
				{
					attemptNumber: 1,
					status: "processing",
					startedAt: new Date(now - 10_000),
				},
			],
			maxAttempts: 2,
			staleAfterMs: 180_000,
			now,
		});
		expect(active).toMatchObject({
			attemptCount: 0,
			remainingAttempts: 2,
			canValidate: false,
			hasProcessingRun: true,
		});

		const stale = getAttemptStatus({
			runs: [
				{
					attemptNumber: 1,
					status: "processing",
					startedAt: new Date(now - 180_001),
				},
			],
			maxAttempts: 2,
			staleAfterMs: 180_000,
			now,
		});
		expect(stale).toMatchObject({
			attemptCount: 0,
			remainingAttempts: 2,
			canValidate: true,
			hasProcessingRun: false,
		});

		const withCompletedAndError = getAttemptStatus({
			runs: [
				{
					attemptNumber: 1,
					status: "error",
					startedAt: new Date(now - 300_000),
				},
				{
					attemptNumber: 2,
					status: "completed",
					startedAt: new Date(now - 100_000),
				},
			],
			maxAttempts: 2,
			staleAfterMs: 180_000,
			now,
		});
		expect(withCompletedAndError.attemptCount).toBe(1);
		expect(withCompletedAndError.remainingAttempts).toBe(1);
	});

	test("acepta únicamente el mismo archivo, hash e id de validación", () => {
		const base = {
			validationIds: ["validation-1", "validation-2"],
			files: [
				{ filePath: "uploads/a.pdf", contentSha256: "sha-a" },
				{ filePath: "uploads/b.pdf", contentSha256: "sha-b" },
			],
			validations: [
				{
					id: "validation-1",
					validationRunId: "run-1",
					filePath: "uploads/a.pdf",
					contentSha256: "sha-a",
					autoResult: "valido" as const,
				},
				{
					id: "validation-2",
					validationRunId: "run-1",
					filePath: "uploads/b.pdf",
					contentSha256: "sha-b",
					autoResult: "revision_manual" as const,
				},
			],
		};

		expect(uploadedValidationPairsMatch(base)).toBe(true);
		expect(
			uploadedValidationPairsMatch({
				...base,
				files: [
					base.files[0],
					{ ...base.files[1], contentSha256: "sha-replaced" },
				],
			}),
		).toBe(false);
		expect(
			uploadedValidationPairsMatch({
				...base,
				validations: [
					base.validations[0],
					{ ...base.validations[1], validationRunId: "run-2" },
				],
			}),
		).toBe(false);
		expect(
			uploadedValidationPairsMatch({
				...base,
				validations: [
					base.validations[0],
					{ ...base.validations[1], autoResult: "error" },
				],
			}),
		).toBe(false);
		expect(
			uploadedValidationPairsMatch({
				...base,
				validationIds: ["validation-1", "validation-1"],
			}),
		).toBe(false);
		expect(
			uploadedValidationPairsMatch({
				...base,
				validations: [base.validations[0]],
			}),
		).toBe(false);
	});
});
