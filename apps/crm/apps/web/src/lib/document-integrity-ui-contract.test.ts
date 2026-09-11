import { describe, expect, test } from "bun:test";

const historySource = await Bun.file(
	new URL("../routes/crm/documentacion/estados-cuenta.tsx", import.meta.url),
).text();
const capacitySource = await Bun.file(
	new URL("../components/credit/BankStatementAnalysis.tsx", import.meta.url),
).text();

describe("document integrity UI contract", () => {
	test("el detalle muestra la última ejecución y permite abrir un documento exacto", () => {
		expect(historySource).toContain("const latestAttempt = group.attempts[0]");
		expect(historySource).toContain("Ejecución {latestAttempt.attemptNumber}");
		expect(historySource).toContain("attempt.validations.map");
		expect(historySource).toContain("Documento $" + "{index + 1}");
		expect(historySource).toContain("validation.id === initialValidationId");
	});

	test("el historial conserva la auditoría del último reinicio", () => {
		expect(historySource).toContain("Cupo de validaciones reiniciado");
		expect(historySource).toContain("group.reset.resetByName");
		expect(historySource).toContain("group.reset.resetAfterAttemptNumber");
	});

	test("explica resultados favorables y señales con lenguaje visible", () => {
		expect(historySource).toContain("Comprobaciones favorables");
		expect(historySource).toContain("Señales y observaciones");
		expect(historySource).toContain("Informativo");
		expect(historySource).toContain("Acción recomendada");
		expect(historySource).toContain("Página {signal.page}");
		expect(capacitySource).toContain("result.validation.recommendedAction");
	});

	test("no renderiza la huella técnica ni respuestas JSON internas", () => {
		for (const internalField of [
			"Huella técnica",
			"technicalFingerprint",
			"aiRawResponse",
			"JSON.stringify",
		]) {
			expect(historySource).not.toContain(internalField);
		}
	});

	test("la oportunidad enlaza al historial y conserva el lote validado", () => {
		expect(capacitySource).toContain("Ver historial de validación");
		expect(capacitySource).toContain('to="/crm/documentacion/estados-cuenta"');
		expect(capacitySource).toContain("validationId: result.validation.id");
		expect(capacitySource).toContain("Aprobado manualmente");
		expect(capacitySource).toContain("getLatestReusableDocumentIntegrityRun");
		expect(capacitySource).toContain("hasCompleteIntegrityValidation");
		expect(capacitySource).toContain(
			"key: results[index]?.fileKey ?? payload.key",
		);
		expect(capacitySource).toContain('"sales",');
		expect(historySource).toContain(
			'canUseValidationHistory || userProfile.data?.role === "sales"',
		);
		expect(historySource).toContain("canViewValidationDetail &&");
	});

	test("un rechazo exige reemplazar documentos y no ofrece aprobación", () => {
		expect(capacitySource).toContain("Ver rechazo");
		expect(capacitySource).toContain("Solicita documentos válidos");
		expect(historySource).toContain(
			"requiresManualApproval(result.autoResult)",
		);
		expect(historySource).toContain("Aprobación histórica");
		expect(historySource).toContain("no habilita un documento rechazado");
		expect(historySource).toContain("No aplica — rechazo directo");
	});

	test("los roles autorizados pueden reiniciar el cupo sin borrar el historial", () => {
		expect(capacitySource).toContain("resetDocumentIntegrityAttempts");
		expect(capacitySource).toContain("Resetear validaciones documentales");
		expect(capacitySource).toContain("El historial se conservará");
		expect(capacitySource).toContain("<AlertDialog>");
	});

	test("un refetch no reemplaza la selección y un fallo permite reintentar", () => {
		expect(capacitySource).toContain("const reusableRunId");
		expect(capacitySource).toContain(
			"[reusableRunId, approvalKey, opportunityId]",
		);
		expect(capacitySource).toContain("manualApproval?.id");
		expect(capacitySource).toContain("const restoredRunIdRef");
		expect(capacitySource).toContain("getReusableBatchSyncAction");
		expect(capacitySource).toContain('else if (action === "clear_restored")');
		expect(capacitySource).toContain("restoredRunIdRef.current = undefined");
		expect(capacitySource).toContain("Cambiar documentos o volver a validar");
		expect(capacitySource).toContain("hasIntegrityLookupError");
		expect(capacitySource).toContain("Reintentar consulta");
		expect(capacitySource).toContain("latestValidatedRunQuery.refetch()");
		expect(capacitySource).toContain(
			"integrityAttemptQuery.data?.canValidate ?? false",
		);
	});

	test("la interfaz valida lotes por oportunidad, no documentos aislados", () => {
		expect(historySource).toContain("Nueva validación por oportunidad");
		expect(historySource).not.toContain("validarDocumentoExistente");
	});
});
