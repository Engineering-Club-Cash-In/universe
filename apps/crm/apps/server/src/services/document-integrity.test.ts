import { describe, expect, test } from "bun:test";

const routerSource = await Bun.file(
	new URL("../routers/document-integrity.ts", import.meta.url),
).text();
const schemaSource = await Bun.file(
	new URL("../db/schema/document-integrity-validations.ts", import.meta.url),
).text();
const forensicsSource = await Bun.file(
	new URL("../lib/document-integrity/pdf-forensics.ts", import.meta.url),
).text();
const serviceSource = await Bun.file(
	new URL("./document-integrity.ts", import.meta.url),
).text();
const migrationSource = await Bun.file(
	new URL(
		"../db/migrations/0033_create_document_integrity_validation.sql",
		import.meta.url,
	),
).text();

describe("document integrity boundaries", () => {
	test("los endpoints aplican el alcance de acceso esperado", () => {
		expect(routerSource).toContain(
			"approveDocumentIntegrityValidation: crmProcedure",
		);
		for (const endpoint of [
			"validarDocumentosExistentes",
			"listDocumentIntegrityValidations",
		]) {
			expect(routerSource).toContain(`${endpoint}: analystProcedure`);
		}
		expect(routerSource).toContain(
			"getDocumentIntegrityValidationGroup: crmOnlyProcedure",
		);
		expect(routerSource).toContain(
			"if (!canViewDocumentIntegrityValidationDetail(userRole))",
		);
		expect(routerSource).toContain(
			'context.userRole === "sales" ? context.userId : undefined',
		);
		const detailStart = serviceSource.indexOf(
			"export async function getDocumentIntegrityValidationGroup",
		);
		const detailSource = serviceSource.slice(detailStart);
		expect(detailSource).toContain(
			"params.salesUserId\n\t\t\t\t\t? eq(opportunities.assignedTo, params.salesUserId)",
		);
		expect(routerSource).toContain(
			"getDocumentIntegrityStatus: crmOnlyProcedure",
		);
		expect(routerSource).toContain(
			"getLatestReusableDocumentIntegrityRun: crmOnlyProcedure",
		);
		expect(routerSource).toContain("validarDocumentosSubidos: crmProcedure");
		expect(
			routerSource.match(
				/assertCanViewDocumentIntegrity\(context\.userRole\)/g,
			),
		).toHaveLength(4);
	});

	test("la aprobación humana queda separada del resultado automático", () => {
		expect(schemaSource).toContain("documentIntegrityValidationApprovals");
		expect(migrationSource).toContain(
			'CREATE TABLE "public"."document_integrity_validation_approvals"',
		);
		expect(serviceSource).toContain("getPendingManualApprovalCount");
		expect(serviceSource).toContain("getManualApprovalAvailability");
		expect(serviceSource).toContain(
			"canApproveDocumentIntegrityValidation(params.userRole)",
		);
		expect(serviceSource).toContain("canWriteOpportunityCreditAnalysis(");
		expect(serviceSource).toContain(
			"reason.length < 5 || reason.length > 1000",
		);
		expect(migrationSource).toContain(
			'length(btrim("reason")) BETWEEN 5 AND 1000',
		);
		expect(serviceSource).toContain(
			'row.autoResult === "revision_manual" && !!row.manualApprovalId',
		);
		expect(serviceSource).toContain("getRejectedDocumentCount(validations)");
		expect(serviceSource).toContain(
			"validations.length !== latestRunValidationTotals.count",
		);
		expect(serviceSource).toContain(
			"Solo se pueden aprobar documentos enviados a revisión manual",
		);
	});

	test("la aprobación se serializa con validaciones, resets y capacidad", () => {
		const approvalStart = serviceSource.indexOf(
			"export async function approveDocumentIntegrityValidation",
		);
		const approvalEnd = serviceSource.indexOf(
			"export async function linkUploadedValidationsToDocuments",
		);
		const approvalSource = serviceSource.slice(approvalStart, approvalEnd);
		expect(approvalSource).toContain("return db.transaction(async (tx)");
		expect(approvalSource).toContain(
			"await tx.execute(lockOpportunity(validation.opportunityId))",
		);
		expect(approvalSource).toContain(
			"await assertNoActiveCapacityAnalysis(tx, validation.opportunityId)",
		);
		expect(approvalSource).toContain(
			".insert(documentIntegrityValidationApprovals)",
		);
	});

	test("solo un duplicado contra una oportunidad ganada suma riesgo", () => {
		expect(serviceSource).toContain("shaInWonOpportunity");
		expect(serviceSource).toContain('row.opportunityStatus === "won"');
	});

	test("el análisis de capacidad exige validar exactamente los mismos archivos", async () => {
		const bankAnalysisSource = await Bun.file(
			new URL("../routers/bank-analysis.ts", import.meta.url),
		).text();
		expect(bankAnalysisSource).toContain("integrityValidationIds");
		expect(bankAnalysisSource).toContain("reserveCapacityAnalysis");
		expect(bankAnalysisSource).toContain('contentSha256: createHash("sha256")');
		expect(bankAnalysisSource).toContain(
			"creditAnalysis.analysisReservationToken",
		);
		expect(serviceSource).toContain("assertNoActiveCapacityAnalysis");
		expect(serviceSource).toContain("releaseCapacityAnalysisReservation");
		expect(serviceSource).toContain(
			"export async function resetOpportunityCreditAnalysis",
		);
		expect(serviceSource).toContain(
			"export async function upsertOpportunityCreditAnalysis",
		);
	});

	test("el historial muestra solo la última ejecución finalizada por oportunidad", async () => {
		expect(serviceSource).toContain(".groupBy(");
		expect(serviceSource).toContain("latestFinalizedRun");
		expect(serviceSource).toContain(
			"latest_run.status in ('completed', 'error')",
		);
		expect(serviceSource).toContain("documentCount:");
		expect(serviceSource).toContain("getDocumentIntegrityValidationGroup");
		expect(serviceSource).toContain("validations,");
		expect(serviceSource).toContain("attempts,");
		expect(serviceSource).toContain(
			'inArray(documentIntegrityValidationRuns.status, ["completed", "error"])',
		);
		expect(serviceSource).toContain("status: latestFinalizedRun.status");
		expect(serviceSource).toContain("latestRun.id === latestFinalizedRun.id");
		expect(serviceSource).toContain("resetByName: user.name");
		expect(serviceSource).toContain("resetByEmail: user.email");
	});

	test("el detalle no expone huellas ni respuestas internas al navegador", () => {
		const start = serviceSource.indexOf(
			"export async function getDocumentIntegrityValidationGroup",
		);
		const handler = serviceSource.slice(start);
		expect(handler).not.toContain("getTableColumns");
		expect(handler).not.toContain("technicalFingerprint");
		expect(handler).not.toContain("requestedBy");
		expect(handler).toContain("documentFilePath,");
		expect(handler).toContain("aiRawResponse,");
		expect(handler).toContain("...details");
		expect(handler).toContain(
			"const positiveChecks = buildDocumentPositiveChecks",
		);
	});

	test("la IA recibe el lote y la persistencia sigue siendo por documento", () => {
		expect(serviceSource).toContain("executeBatchWithFallback(documents");
		expect(serviceSource).toContain("callBatch: callIntegrityAiBatch");
		expect(serviceSource).toContain("estadoCuentaBatchAiSchema");
		expect(serviceSource).toContain("documents.flatMap");
		const persistStart = serviceSource.indexOf(
			"async function persistValidation",
		);
		const persistEnd = serviceSource.indexOf(
			"function errorMessage",
			persistStart,
		);
		expect(serviceSource.slice(persistStart, persistEnd)).not.toContain(
			"generateObject",
		);
	});

	test("un fallo de almacenamiento no genera evidencia forense ficticia", () => {
		const persistStart = serviceSource.indexOf(
			"async function persistValidation",
		);
		const persistEnd = serviceSource.indexOf(
			"function errorMessage",
			persistStart,
		);
		const handler = serviceSource.slice(persistStart, persistEnd);
		expect(handler).not.toContain('Buffer.from("%PDF');
		expect(handler).toContain('result: "error" as const');
		expect(handler).toContain("signals: []");
		expect(handler).toContain("technicalFingerprint: null");
		expect(handler).toContain("publicPipelineError");
		expect(handler).toContain("errorMessage: internalPipelineError");
		expect(handler).toContain(
			"No se pudo leer el archivo almacenado. Intenta nuevamente.",
		);
	});

	test("cada lote reserva uno de dos intentos por oportunidad", () => {
		expect(serviceSource).toContain("MAX_DOCUMENT_INTEGRITY_ATTEMPTS = 2");
		expect(serviceSource).toContain("pg_advisory_xact_lock");
		expect(serviceSource).toContain("createValidationRun(params)");
		expect(schemaSource).toContain("documentIntegrityValidationRuns");
		expect(migrationSource).toContain(
			'UNIQUE INDEX "doc_integrity_run_opp_attempt_unique"',
		);
	});

	test("el cupo se puede reiniciar sin borrar el historial", () => {
		expect(routerSource).toContain(
			"resetDocumentIntegrityAttempts: crmProcedure",
		);
		expect(routerSource).toContain('context.userRole !== "admin"');
		expect(routerSource).toContain('context.userRole !== "sales_supervisor"');
		expect(routerSource).toContain('context.userRole !== "analyst"');
		expect(schemaSource).toContain("documentIntegrityValidationResets");
		expect(schemaSource).toContain("resetAfterAttemptNumber");
		expect(schemaSource).toContain("resetBy");
		expect(serviceSource).toContain(
			"export async function resetDocumentIntegrityAttempts",
		);
		expect(serviceSource).toContain("runsInCycle: attempts?.runsInCycle ?? 0");
		expect(serviceSource).not.toContain(
			"delete(documentIntegrityValidationRuns)",
		);
		expect(migrationSource).toContain(
			'CREATE TABLE "public"."document_integrity_validation_resets"',
		);
	});

	test("un lote técnico incompleto queda error y no consume cupo", () => {
		expect(serviceSource).toContain(
			"completedAttempts: attempts?.completed ?? 0",
		);
		expect(serviceSource).toContain("completedSuccessfully");
		expect(serviceSource).toContain(
			'completedSuccessfully ? "completed" : "error"',
		);
	});

	test("un lote reemplazado no puede volver a completarse", () => {
		expect(serviceSource).toContain("MAX_AI_CALL_WAVES");
		// La ventana cubre las olas de IA y la fase forense/persistencia posterior.
		expect(serviceSource).toContain("AI_TIMEOUT_MS * MAX_AI_CALL_WAVES");
		expect(serviceSource).toContain(
			"MAX_DOCUMENTS_PER_VALIDATION * MAX_PDF_PARSE_LEASE_MS",
		);
		const finishStart = serviceSource.indexOf(
			"async function finishValidationRun",
		);
		const finishEnd = serviceSource.indexOf(
			"function buildLeadName",
			finishStart,
		);
		expect(serviceSource.slice(finishStart, finishEnd)).toContain(
			'eq(documentIntegrityValidationRuns.status, "processing")',
		);
	});

	test("el último lote de capacidad se puede retomar sin repetir la IA", () => {
		expect(serviceSource).toContain("getLatestReusableDocumentIntegrityRun");
		expect(serviceSource).toContain('"analisis_capacidad"');
		expect(serviceSource).toContain("validation.hasLinkedDocuments");
		expect(serviceSource).toContain("originalNameFromStorageKey");
		expect(serviceSource).toContain(
			'run.validationSource !== "analisis_capacidad"',
		);
		expect(serviceSource).toContain('run.status !== "completed"');
		expect(serviceSource).toContain('validation.result === "error"');
	});

	test("el análisis financiero exige un único intento completo y sin errores", () => {
		expect(serviceSource).toContain(
			'eq(documentIntegrityValidationRuns.status, "completed")',
		);
		expect(serviceSource).toContain("uploadedValidationPairsMatch");
		expect(serviceSource).toContain("resetAfterAttemptNumber");
		expect(serviceSource).toContain(
			"El cupo de validaciones documentales fue reiniciado",
		);
	});

	test("el estado por documento caduca con un reset o una ejecucion posterior", () => {
		const statusStart = serviceSource.indexOf(
			"export async function getDocumentIntegrityStatuses",
		);
		const statusEnd = serviceSource.indexOf(
			"export async function getDocumentIntegrityAttemptStatus",
		);
		const handler = serviceSource.slice(statusStart, statusEnd);
		expect(handler).toContain("current_reset.reset_after_attempt_number");
		expect(handler).toContain("isCurrentCompletedRun");
		expect(handler).toContain("!row.isCurrentCompletedRun");
		expect(handler).toContain("row.linkedFilePath");
	});

	test("una validación puede respaldar varios documentos del checklist", () => {
		expect(schemaSource).toContain("documentIntegrityValidationDocuments");
		expect(schemaSource).toContain("linkedFilePath");
		expect(migrationSource).toContain(
			'CREATE TABLE "public"."document_integrity_validation_documents"',
		);
		expect(serviceSource).toContain("const linksBySource");
		expect(serviceSource).toContain("links.map((link) => ({");
		expect(serviceSource).toContain(
			"documentIntegrityValidationDocuments.opportunityDocumentId",
		);
		expect(serviceSource).toContain("linkedDocumentFilePath");
		expect(serviceSource).toContain(
			"linked_opportunity_document.file_path = linked_document.linked_file_path",
		);
		expect(serviceSource).toContain(
			"linkedDocumentFilePath ?? documentFilePath",
		);
	});

	test("el fallback limita concurrencia y no insiste ante rate limit", () => {
		expect(serviceSource).toContain(
			"fallbackConcurrency: AI_FALLBACK_CONCURRENCY",
		);
		expect(serviceSource).toContain("AI_FALLBACK_CONCURRENCY = 2");
		expect(serviceSource).toContain(
			"shouldFallback: (error) => !isRateLimitError(error)",
		);
	});

	test("el status redactado no devuelve evidencia ni score", () => {
		const start = routerSource.indexOf("getDocumentIntegrityStatus:");
		const end = routerSource.indexOf("validarDocumentosSubidos:", start);
		const handler = routerSource.slice(start, end);
		for (const secret of [
			"signals",
			"technicalFingerprint",
			"aiRawResponse",
			"autoReason",
			"autoScore",
		]) {
			expect(handler).not.toContain(secret);
		}
	});

	test("los endpoints de validación devuelven solo el DTO público", () => {
		const formatterStart = routerSource.indexOf("function toPublicValidation");
		const formatterEnd = routerSource.indexOf(
			"export const documentIntegrityProcedures",
			formatterStart,
		);
		const formatter = routerSource.slice(formatterStart, formatterEnd);
		for (const internalField of [
			"technicalFingerprint",
			"aiRawResponse",
			"errorMessage",
			"autoScore",
		]) {
			expect(formatter).not.toContain(internalField);
		}
		expect(routerSource.match(/toPublicValidation\(/g)).toHaveLength(3);
	});

	test("pdf-lib nunca serializa ni reescribe el documento", () => {
		expect(forensicsSource).not.toContain(".save(");
	});

	test("la tabla automática no mezcla resolución humana ni datos del intento", () => {
		for (const removedField of [
			"finalResult",
			"reviewedBy",
			"reviewedAt",
			"reviewNotes",
			"subjectType",
			"subjectId",
		]) {
			expect(schemaSource).not.toContain(removedField);
		}
		const childTable = schemaSource.slice(
			schemaSource.indexOf("export const documentIntegrityValidations"),
		);
		for (const runField of [
			"opportunityId",
			"validationSource",
			"requestedBy",
			"validatedAt",
		]) {
			expect(childTable).not.toContain(runField);
		}
		expect(childTable).toContain("validationRunId");
		const runTable = schemaSource.slice(
			schemaSource.indexOf("export const documentIntegrityValidationRuns"),
			schemaSource.indexOf("export const documentIntegrityValidations"),
		);
		for (const runField of [
			"opportunityId",
			"validationSource",
			"requestedBy",
			"startedAt",
			"completedAt",
		]) {
			expect(runTable).toContain(runField);
		}
		expect(migrationSource).not.toContain('"validated_at"');
		expect(migrationSource).toContain('"started_at" timestamp with time zone');
		expect(migrationSource).toContain(
			'"completed_at" timestamp with time zone',
		);
		expect(migrationSource).toContain(
			'"doc_integrity_val_identifier_normalized_idx"',
		);
	});
});
