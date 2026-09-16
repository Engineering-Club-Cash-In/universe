import { describe, expect, test } from "bun:test";
import {
	aggregateIntegrityResult,
	getReusableBatchSyncAction,
	hasCompleteIntegrityValidation,
	type IntegrityResult,
} from "./document-integrity-flow";

describe("document integrity UI flow", () => {
	test("habilita capacidad para veredictos que no requieren aprobación manual", () => {
		for (const result of [
			"valido",
			"observacion",
		] satisfies IntegrityResult[]) {
			expect(
				hasCompleteIntegrityValidation({
					payloads: [{ key: "a.pdf" }],
					results: [{ validation: { result } }],
				}),
			).toBe(true);
		}
	});

	test("la revisión manual bloquea capacidad hasta aprobarse", () => {
		expect(
			hasCompleteIntegrityValidation({
				payloads: [{ key: "a.pdf" }],
				results: [
					{ validation: { result: "revision_manual", manualApproval: null } },
				],
			}),
		).toBe(false);
		expect(
			hasCompleteIntegrityValidation({
				payloads: [{ key: "a.pdf" }],
				results: [
					{
						validation: {
							result: "revision_manual",
							manualApproval: { id: "approval-1" },
						},
					},
				],
			}),
		).toBe(true);
	});

	test("un rechazo bloquea capacidad aunque exista una aprobación histórica", () => {
		expect(
			hasCompleteIntegrityValidation({
				payloads: [{ key: "a.pdf" }],
				results: [
					{
						validation: {
							result: "rechazado",
							manualApproval: { id: "approval-antigua" },
						},
					},
				],
			}),
		).toBe(false);
	});

	test("limpia solo lotes restaurados y conserva resultados locales", () => {
		expect(
			getReusableBatchSyncAction({
				reusableRunId: undefined,
				restoredRunId: "run-a",
			}),
		).toBe("clear_restored");
		expect(
			getReusableBatchSyncAction({
				reusableRunId: undefined,
				restoredRunId: undefined,
			}),
		).toBe("keep_local");
		expect(
			getReusableBatchSyncAction({
				reusableRunId: "run-b",
				reusableOpportunityId: "opportunity-1",
				currentOpportunityId: "opportunity-1",
				restoredRunId: undefined,
			}),
		).toBe("restore");
	});

	test("un error técnico no habilita el análisis financiero", () => {
		expect(
			hasCompleteIntegrityValidation({
				payloads: [{ key: "a.pdf" }],
				results: [{ validation: { result: "error" } }],
			}),
		).toBe(false);
	});

	test("no habilita capacidad si falta validar un archivo o el lote está vacío", () => {
		expect(
			hasCompleteIntegrityValidation({
				payloads: [{ key: "a.pdf" }, { key: "b.pdf" }],
				results: [{ validation: { result: "valido" } }, { validation: null }],
			}),
		).toBe(false);
		expect(hasCompleteIntegrityValidation({ payloads: [], results: [] })).toBe(
			false,
		);
		expect(hasCompleteIntegrityValidation(null)).toBe(false);
	});

	test("resume un intento usando el resultado más restrictivo", () => {
		expect(
			aggregateIntegrityResult([
				{ autoResult: "valido" },
				{ autoResult: "revision_manual" },
				{ autoResult: "observacion" },
			]),
		).toBe("revision_manual");
		expect(
			aggregateIntegrityResult([
				{ autoResult: "revision_manual" },
				{ autoResult: "rechazado" },
			]),
		).toBe("rechazado");
		expect(aggregateIntegrityResult([{ autoResult: "valido" }])).toBe("valido");
	});
});
