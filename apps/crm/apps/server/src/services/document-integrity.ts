import { createHash, randomUUID } from "node:crypto";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import {
	and,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	coDebtors,
	creditAnalysis,
	leads,
	opportunities,
} from "../db/schema/crm";
import {
	documentIntegrityValidationApprovals,
	documentIntegrityValidationDocuments,
	documentIntegrityValidationResets,
	documentIntegrityValidationRuns,
	documentIntegrityValidations,
} from "../db/schema/document-integrity-validations";
import { opportunityDocuments } from "../db/schema/documents";
import { canWriteOpportunityCreditAnalysis } from "../lib/credit-analysis-ownership";
import {
	executeBatchWithFallback,
	indexBatchResults,
} from "../lib/document-integrity/batch-execution";
import {
	buildDocumentPositiveChecks,
	buildDocumentRecommendedAction,
} from "../lib/document-integrity/decision-evidence";
import { runDocumentIntegrityEngine } from "../lib/document-integrity/engine";
import {
	isImmutableDocumentIntegrityEvidencePath,
	originalNameFromDocumentIntegrityPath,
} from "../lib/document-integrity/evidence-path";
import {
	ESTADO_CUENTA_BATCH_PROMPT,
	estadoCuentaBatchAiSchema,
	normalizeStatementIdentifier,
} from "../lib/document-integrity/kinds/estado-cuenta";
import {
	MAX_PDF_PARSE_LEASE_MS,
	scanPdfBytes,
} from "../lib/document-integrity/pdf-forensics";
import type { DocumentIntegrityAiResult } from "../lib/document-integrity/types";
import {
	canApproveDocumentIntegrityValidation,
	canRunDocumentIntegrityValidation,
	getAttemptAvailability,
	getAttemptStatus,
	getManualApprovalAvailability,
	getPendingManualApprovalCount,
	getRejectedDocumentCount,
	getResetAvailability,
	isCompleteValidationRun,
	uploadedValidationPairsMatch,
} from "../lib/document-integrity/workflow-policy";
import {
	buildUploadPrefix,
	getFileBuffer,
	getFileUrl,
	uploadBufferToR2,
	verifyUploadedDocumentInR2,
} from "../lib/storage";

export const DOC_INTEGRITY_MODEL =
	process.env.DOC_INTEGRITY_MODEL || "gemini-3-flash-preview";
const MAX_BATCH_SIZE_BYTES = 45 * 1024 * 1024;
const MAX_DOCUMENT_INTEGRITY_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENTS_PER_VALIDATION = 9;
const AI_FALLBACK_CONCURRENCY = 2;
const AI_TIMEOUT_MS = 120_000;
const RETRY_WINDOW_MS = 5 * 60_000;
const MAX_AI_CALL_WAVES =
	1 + Math.ceil(MAX_DOCUMENTS_PER_VALIDATION / AI_FALLBACK_CONCURRENCY);
// Cubre las olas de Gemini mas la fase forense secuencial. Usa el arriendo y no
// PARSE_BUDGET_MS, que es cooperativo y PDFDocument.load() puede rebasarlo.
const RUN_STALE_AFTER_MS =
	AI_TIMEOUT_MS * MAX_AI_CALL_WAVES +
	MAX_DOCUMENTS_PER_VALIDATION * MAX_PDF_PARSE_LEASE_MS +
	60_000;
export const MAX_DOCUMENT_INTEGRITY_ATTEMPTS = 2;
// Techo de ejecuciones por ciclo sin importar su estado. Acota el gasto en IA
// que producen los fallos tecnicos, que a proposito no consumen cupo.
const MAX_RUNS_PER_CYCLE = 6;
const CAPACITY_ANALYSIS_RESERVATION_STALE_AFTER_MS = 5 * 60_000;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class DocumentIntegrityError extends Error {
	constructor(
		public readonly code:
			| "NOT_FOUND"
			| "BAD_REQUEST"
			| "FORBIDDEN"
			| "TOO_MANY_REQUESTS",
		message: string,
	) {
		super(message);
		this.name = "DocumentIntegrityError";
	}
}

export interface UploadedBankStatementInput {
	name: string;
	key: string;
	mimeType: string;
}

type BankStatementDocumentType =
	| "estados_cuenta_1"
	| "estados_cuenta_2"
	| "estados_cuenta_3"
	| "bank_statement"
	| "other";

interface PreparedValidationDocument {
	opportunityDocumentId?: string;
	documentType: BankStatementDocumentType;
	filePath: string;
	fileName: string;
	buffer: Buffer | null;
	storageError?: string;
}

type ValidationSource = "documentacion" | "analisis_capacidad";

async function getLatestResetAttemptNumber(opportunityId: string) {
	const [reset] = await db
		.select({
			attemptNumber: sql<number>`coalesce(max(${documentIntegrityValidationResets.resetAfterAttemptNumber}), 0)::int`,
		})
		.from(documentIntegrityValidationResets)
		.where(eq(documentIntegrityValidationResets.opportunityId, opportunityId));
	return reset?.attemptNumber ?? 0;
}

// Todos los sitios que bloquean una oportunidad deben usar esta funcion, o
// dejarian de excluirse entre si. hashtextextended da 64 bits; hashtext (int4)
// colisiona entre oportunidades distintas.
function lockOpportunity(opportunityId: string) {
	return sql`SELECT pg_advisory_xact_lock(hashtextextended(${opportunityId}, 0))`;
}

async function clearStaleCapacityAnalysisReservation(
	tx: Transaction,
	opportunityId: string,
) {
	await tx
		.update(creditAnalysis)
		.set({
			analysisReservationToken: null,
			analysisReservationStartedAt: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(creditAnalysis.opportunityId, opportunityId),
				isNotNull(creditAnalysis.analysisReservationToken),
				lt(
					creditAnalysis.analysisReservationStartedAt,
					new Date(Date.now() - CAPACITY_ANALYSIS_RESERVATION_STALE_AFTER_MS),
				),
			),
		);
}

async function assertNoActiveCapacityAnalysis(
	tx: Transaction,
	opportunityId: string,
) {
	await clearStaleCapacityAnalysisReservation(tx, opportunityId);
	const [analysis] = await tx
		.select({ token: creditAnalysis.analysisReservationToken })
		.from(creditAnalysis)
		.where(eq(creditAnalysis.opportunityId, opportunityId))
		.limit(1);
	if (analysis?.token) {
		throw new DocumentIntegrityError(
			"TOO_MANY_REQUESTS",
			"Hay un análisis de capacidad en proceso. Espera a que finalice antes de validar, editar o reiniciar.",
		);
	}
}

async function createValidationRun(params: {
	opportunityId: string;
	validationSource: ValidationSource;
	requestedBy: string;
	rejectIfAnalysisCompleted?: boolean;
}) {
	return db.transaction(async (tx) => {
		await tx.execute(lockOpportunity(params.opportunityId));
		await assertNoActiveCapacityAnalysis(tx, params.opportunityId);
		// Bajo el mismo lock que reserva el intento: fuera de la transaccion la
		// ventana abarca las descargas de R2.
		if (params.rejectIfAnalysisCompleted) {
			const [existingAnalysis] = await tx
				.select({ analyzedAt: creditAnalysis.analyzedAt })
				.from(creditAnalysis)
				.where(eq(creditAnalysis.opportunityId, params.opportunityId))
				.limit(1);
			if (existingAnalysis?.analyzedAt) {
				throw new DocumentIntegrityError(
					"BAD_REQUEST",
					"Esta oportunidad ya tiene un análisis de capacidad de pago completado.",
				);
			}
		}
		await tx
			.update(documentIntegrityValidationRuns)
			.set({ status: "error", completedAt: sql`clock_timestamp()` })
			.where(
				and(
					eq(
						documentIntegrityValidationRuns.opportunityId,
						params.opportunityId,
					),
					eq(documentIntegrityValidationRuns.status, "processing"),
					lt(
						documentIntegrityValidationRuns.startedAt,
						new Date(Date.now() - RUN_STALE_AFTER_MS),
					),
				),
			);
		const [latestReset] = await tx
			.select({
				attemptNumber: sql<number>`coalesce(max(${documentIntegrityValidationResets.resetAfterAttemptNumber}), 0)::int`,
			})
			.from(documentIntegrityValidationResets)
			.where(
				eq(
					documentIntegrityValidationResets.opportunityId,
					params.opportunityId,
				),
			);
		const resetAfterAttemptNumber = latestReset?.attemptNumber ?? 0;
		const [attempts] = await tx
			.select({
				latest: sql<number>`coalesce(max(${documentIntegrityValidationRuns.attemptNumber}), 0)::int`,
				completed: sql<number>`count(*) filter (where ${documentIntegrityValidationRuns.status} = 'completed' and ${documentIntegrityValidationRuns.attemptNumber} > ${resetAfterAttemptNumber})::int`,
				runsInCycle: sql<number>`count(*) filter (where ${documentIntegrityValidationRuns.attemptNumber} > ${resetAfterAttemptNumber})::int`,
				hasProcessingRun: sql<boolean>`coalesce(bool_or(${documentIntegrityValidationRuns.status} = 'processing'), false)`,
			})
			.from(documentIntegrityValidationRuns)
			.where(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
			);
		const availability = getAttemptAvailability({
			latestAttempt: attempts?.latest ?? 0,
			completedAttempts: attempts?.completed ?? 0,
			runsInCycle: attempts?.runsInCycle ?? 0,
			hasProcessingRun: attempts?.hasProcessingRun ?? false,
			maxAttempts: MAX_DOCUMENT_INTEGRITY_ATTEMPTS,
			maxRunsPerCycle: MAX_RUNS_PER_CYCLE,
		});
		if (!availability.allowed && availability.reason === "processing") {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				"Esta oportunidad ya tiene una validación documental en proceso.",
			);
		}
		if (!availability.allowed && availability.reason === "cost_cap") {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				"Esta oportunidad acumuló demasiadas validaciones fallidas. Pide a un supervisor que reinicie el cupo.",
			);
		}
		if (!availability.allowed) {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				`Esta oportunidad alcanzó el límite de ${MAX_DOCUMENT_INTEGRITY_ATTEMPTS} intentos de validación documental.`,
			);
		}

		const [run] = await tx
			.insert(documentIntegrityValidationRuns)
			.values({
				opportunityId: params.opportunityId,
				attemptNumber: availability.nextAttempt,
				validationSource: params.validationSource,
				requestedBy: params.requestedBy,
			})
			.returning();
		return run;
	});
}

export async function resetDocumentIntegrityAttempts(params: {
	opportunityId: string;
	userId: string;
}) {
	return db.transaction(async (tx) => {
		await tx.execute(lockOpportunity(params.opportunityId));
		await assertNoActiveCapacityAnalysis(tx, params.opportunityId);
		const [opportunity] = await tx
			.select({ id: opportunities.id })
			.from(opportunities)
			.where(eq(opportunities.id, params.opportunityId))
			.limit(1);
		if (!opportunity)
			throw new DocumentIntegrityError(
				"NOT_FOUND",
				"Oportunidad no encontrada",
			);

		await tx
			.update(documentIntegrityValidationRuns)
			.set({ status: "error", completedAt: sql`clock_timestamp()` })
			.where(
				and(
					eq(
						documentIntegrityValidationRuns.opportunityId,
						params.opportunityId,
					),
					eq(documentIntegrityValidationRuns.status, "processing"),
					lt(
						documentIntegrityValidationRuns.startedAt,
						new Date(Date.now() - RUN_STALE_AFTER_MS),
					),
				),
			);
		const [latestReset] = await tx
			.select({
				attemptNumber: sql<number>`coalesce(max(${documentIntegrityValidationResets.resetAfterAttemptNumber}), 0)::int`,
			})
			.from(documentIntegrityValidationResets)
			.where(
				eq(
					documentIntegrityValidationResets.opportunityId,
					params.opportunityId,
				),
			);
		const resetAfterAttemptNumber = latestReset?.attemptNumber ?? 0;
		const [attempts] = await tx
			.select({
				latest: sql<number>`coalesce(max(${documentIntegrityValidationRuns.attemptNumber}), 0)::int`,
				completed: sql<number>`count(*) filter (where ${documentIntegrityValidationRuns.status} = 'completed' and ${documentIntegrityValidationRuns.attemptNumber} > ${resetAfterAttemptNumber})::int`,
				runsInCycle: sql<number>`count(*) filter (where ${documentIntegrityValidationRuns.attemptNumber} > ${resetAfterAttemptNumber})::int`,
				hasProcessingRun: sql<boolean>`coalesce(bool_or(${documentIntegrityValidationRuns.status} = 'processing'), false)`,
			})
			.from(documentIntegrityValidationRuns)
			.where(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
			);
		const resetAvailability = getResetAvailability({
			latestAttempt: attempts?.latest ?? 0,
			completedAttempts: attempts?.completed ?? 0,
			runsInCycle: attempts?.runsInCycle ?? 0,
			hasProcessingRun: attempts?.hasProcessingRun ?? false,
			maxAttempts: MAX_DOCUMENT_INTEGRITY_ATTEMPTS,
			maxRunsPerCycle: MAX_RUNS_PER_CYCLE,
		});
		if (
			!resetAvailability.allowed &&
			resetAvailability.reason === "processing"
		) {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				"No se puede reiniciar el cupo mientras hay una validación en proceso.",
			);
		}
		if (!resetAvailability.allowed) {
			throw new DocumentIntegrityError(
				"BAD_REQUEST",
				"La oportunidad todavía tiene validaciones documentales disponibles.",
			);
		}

		await tx.insert(documentIntegrityValidationResets).values({
			opportunityId: params.opportunityId,
			resetAfterAttemptNumber: resetAvailability.resetAfterAttemptNumber,
			resetBy: params.userId,
		});
		return { success: true as const };
	});
}

async function finishValidationRun(
	runId: string,
	status: "completed" | "error",
) {
	const [finished] = await db
		.update(documentIntegrityValidationRuns)
		.set({ status, completedAt: sql`clock_timestamp()` })
		.where(
			and(
				eq(documentIntegrityValidationRuns.id, runId),
				eq(documentIntegrityValidationRuns.status, "processing"),
			),
		)
		.returning({ completedAt: documentIntegrityValidationRuns.completedAt });
	if (!finished?.completedAt)
		throw new Error("No se pudo finalizar el intento de validación documental");
	return finished.completedAt;
}

function buildLeadName(lead: {
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
}): string {
	return [lead.firstName, lead.middleName, lead.lastName, lead.secondLastName]
		.filter((part) => part?.trim())
		.join(" ");
}

async function getOpportunityContext(opportunityId: string) {
	const [row] = await db
		.select({
			opportunityId: opportunities.id,
			leadId: opportunities.leadId,
			assignedTo: opportunities.assignedTo,
			title: opportunities.title,
			firstName: leads.firstName,
			middleName: leads.middleName,
			lastName: leads.lastName,
			secondLastName: leads.secondLastName,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);
	if (!row)
		throw new DocumentIntegrityError("NOT_FOUND", "Oportunidad no encontrada");

	const coDebtorRows = await db
		.select({ fullName: coDebtors.fullName })
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, opportunityId));
	const names =
		row.firstName && row.lastName
			? [
					buildLeadName({
						firstName: row.firstName,
						middleName: row.middleName,
						lastName: row.lastName,
						secondLastName: row.secondLastName,
					}),
				]
			: [];
	names.push(...coDebtorRows.map((coDebtor) => coDebtor.fullName));
	return { ...row, registeredNames: names };
}

interface IntegrityAiDocument {
	reference: string;
	buffer: Buffer;
	filename: string;
}

async function callIntegrityAiBatch(
	documents: IntegrityAiDocument[],
): Promise<Map<string, DocumentIntegrityAiResult>> {
	const result = await generateObject({
		model: google(DOC_INTEGRITY_MODEL),
		schema: estadoCuentaBatchAiSchema,
		abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
		messages: [
			{ role: "system", content: ESTADO_CUENTA_BATCH_PROMPT },
			{
				role: "user",
				content: documents.flatMap((document) => [
					{
						type: "text" as const,
						text: `document_ref: ${document.reference}\nnombre_archivo: ${document.filename}`,
					},
					{
						type: "file" as const,
						data: document.buffer,
						mediaType: "application/pdf" as const,
						filename: document.filename,
					},
				]),
			},
		],
	});

	return indexBatchResults({
		expectedReferences: documents.map((document) => document.reference),
		results: result.object.documentos,
		getReference: (document) => document.document_ref,
		mapResult: ({ document_ref: _reference, ...analysis }) => analysis,
	});
}

async function duplicateContext(params: {
	sha256: string;
	identifier: string | null;
	opportunityId: string;
	leadId: string | null;
}) {
	const shaRows = await db
		.select({
			opportunityId: documentIntegrityValidationRuns.opportunityId,
			opportunityStatus: opportunities.status,
		})
		.from(documentIntegrityValidations)
		.innerJoin(
			documentIntegrityValidationRuns,
			eq(
				documentIntegrityValidations.validationRunId,
				documentIntegrityValidationRuns.id,
			),
		)
		.innerJoin(
			opportunities,
			eq(documentIntegrityValidationRuns.opportunityId, opportunities.id),
		)
		.where(eq(documentIntegrityValidations.contentSha256, params.sha256));

	let identifierInOtherLead = false;
	if (params.identifier && params.leadId) {
		const [reused] = await db
			.select({ id: documentIntegrityValidations.id })
			.from(documentIntegrityValidations)
			.innerJoin(
				documentIntegrityValidationRuns,
				eq(
					documentIntegrityValidations.validationRunId,
					documentIntegrityValidationRuns.id,
				),
			)
			.innerJoin(
				opportunities,
				eq(documentIntegrityValidationRuns.opportunityId, opportunities.id),
			)
			.where(
				and(
					sql`upper(regexp_replace(coalesce(${documentIntegrityValidations.aiRawResponse}->>'identificador_detectado', ''), '[^A-Za-z0-9]', '', 'g')) = ${params.identifier}`,
					ne(opportunities.leadId, params.leadId),
				),
			)
			.limit(1);
		identifierInOtherLead = !!reused;
	}

	return {
		shaInSameOpportunity: shaRows.some(
			(row) => row.opportunityId === params.opportunityId,
		),
		shaInOtherOpportunity: shaRows.some(
			(row) => row.opportunityId !== params.opportunityId,
		),
		shaInWonOpportunity: shaRows.some(
			(row) =>
				row.opportunityId !== params.opportunityId &&
				row.opportunityStatus === "won",
		),
		identifierInOtherLead,
	};
}

async function assertRetryAllowed(sha256: string): Promise<number> {
	const [latest] = await db
		.select({
			retryCount: documentIntegrityValidations.retryCount,
			autoResult: documentIntegrityValidations.autoResult,
			completedAt: documentIntegrityValidationRuns.completedAt,
			startedAt: documentIntegrityValidationRuns.startedAt,
		})
		.from(documentIntegrityValidations)
		.innerJoin(
			documentIntegrityValidationRuns,
			eq(
				documentIntegrityValidations.validationRunId,
				documentIntegrityValidationRuns.id,
			),
		)
		.where(eq(documentIntegrityValidations.contentSha256, sha256))
		.orderBy(desc(documentIntegrityValidationRuns.startedAt))
		.limit(1);
	if (
		latest &&
		latest.retryCount >= 3 &&
		Date.now() - (latest.completedAt ?? latest.startedAt).getTime() <
			RETRY_WINDOW_MS
	) {
		throw new DocumentIntegrityError(
			"TOO_MANY_REQUESTS",
			"Este archivo alcanzó el límite temporal de reintentos. Espera cinco minutos.",
		);
	}
	return latest?.autoResult === "error" ? latest.retryCount + 1 : 0;
}

async function persistValidation(params: {
	validationRunId: string;
	opportunityDocumentId?: string;
	opportunityId: string;
	documentType: BankStatementDocumentType;
	filePath: string;
	fileName: string;
	buffer: Buffer | null;
	registeredNames: string[];
	leadId: string | null;
	storageError?: string;
	llm?: DocumentIntegrityAiResult | null;
	aiError?: string;
	prevalidatedRetryCount?: number;
}) {
	const unavailableSha = createHash("sha256")
		.update(`unavailable:${params.filePath}`)
		.digest("hex");
	const sha256 = params.buffer
		? scanPdfBytes(params.buffer).sha256
		: unavailableSha;
	const retryCount =
		params.prevalidatedRetryCount ?? (await assertRetryAllowed(sha256));
	const llm = params.llm ?? null;
	const internalPipelineError =
		params.storageError ??
		params.aiError ??
		(params.buffer
			? null
			: "No se recibió el contenido del archivo almacenado");
	const publicPipelineError =
		params.storageError || !params.buffer
			? "No se pudo leer el archivo almacenado. Intenta nuevamente."
			: params.aiError
				? "No se pudo completar la validación automática. Intenta nuevamente."
				: null;

	const engineResult = params.buffer
		? await runDocumentIntegrityEngine({
				buffer: params.buffer,
				llm,
				registeredNames: params.registeredNames,
				duplicates: await duplicateContext({
					sha256,
					identifier: normalizeStatementIdentifier(
						llm?.identificador_detectado,
					),
					opportunityId: params.opportunityId,
					leadId: params.leadId,
				}),
				pipelineError: publicPipelineError,
			})
		: {
				result: "error" as const,
				score: 0,
				reason:
					publicPipelineError ??
					"No se pudo completar la validación automática. Intenta nuevamente.",
				signals: [],
				technicalFingerprint: null,
			};
	const saved = await db.transaction(async (tx) => {
		const [validation] = await tx
			.insert(documentIntegrityValidations)
			.values({
				validationRunId: params.validationRunId,
				documentType: params.documentType,
				documentFilePath: params.filePath,
				contentSha256: sha256,
				autoResult: engineResult.result,
				autoScore: engineResult.score,
				autoReason: engineResult.reason,
				signals: engineResult.signals,
				technicalFingerprint: engineResult.technicalFingerprint,
				aiRawResponse: llm as Record<string, unknown> | null,
				retryCount: internalPipelineError ? retryCount || 1 : 0,
				errorMessage: internalPipelineError,
			})
			.returning();
		if (validation && params.opportunityDocumentId) {
			await tx.insert(documentIntegrityValidationDocuments).values({
				validationId: validation.id,
				opportunityDocumentId: params.opportunityDocumentId,
				linkedFilePath: params.filePath,
			});
		}
		return validation;
	});
	return saved;
}

interface PreparedValidationResult {
	validation: Awaited<ReturnType<typeof persistValidation>> | null;
	error?: string;
	errorCode?: DocumentIntegrityError["code"];
}

function buildValidationEvidenceFilePath(params: {
	opportunityId: string;
	validationId: string;
	contentSha256: string;
	sourceFilePath: string;
}) {
	const sourceName = params.sourceFilePath.split("/").at(-1) ?? "document.pdf";
	const safeName = sourceName.replace(/[^A-Za-z0-9._-]/g, "_");
	return `${buildUploadPrefix("bank_statement", params.opportunityId)}/validated/${params.validationId}/${params.contentSha256}-${safeName}`;
}

async function freezeCompletedValidationEvidence(params: {
	opportunityId: string;
	documents: PreparedValidationDocument[];
	results: PreparedValidationResult[];
}) {
	const frozen: Array<{
		validation: NonNullable<PreparedValidationResult["validation"]>;
		filePath: string;
	}> = [];
	for (const [index, result] of params.results.entries()) {
		if (!result.validation || result.validation.autoResult === "error") continue;
		const document = params.documents[index];
		if (!document?.buffer)
			throw new Error("Missing source bytes for completed validation evidence");
		const filePath = buildValidationEvidenceFilePath({
			opportunityId: params.opportunityId,
			validationId: result.validation.id,
			contentSha256: result.validation.contentSha256,
			sourceFilePath: document.filePath,
		});
		await uploadBufferToR2(filePath, document.buffer);
		frozen.push({ validation: result.validation, filePath });
	}
	if (frozen.length === 0) return;

	await db.transaction(async (tx) => {
		for (const item of frozen) {
			await tx
				.update(documentIntegrityValidations)
				.set({ documentFilePath: item.filePath })
				.where(eq(documentIntegrityValidations.id, item.validation.id));
		}
	});
	for (const item of frozen) item.validation.documentFilePath = item.filePath;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown) {
	const status =
		typeof error === "object" && error !== null
			? ((error as { statusCode?: unknown; status?: unknown }).statusCode ??
				(error as { status?: unknown }).status)
			: undefined;
	const message = errorMessage(error).toLowerCase();
	return (
		status === 429 ||
		message.includes("rate limit") ||
		message.includes("too many requests") ||
		message.includes("resource_exhausted")
	);
}

async function callIntegrityAiBatchWithFallback(
	documents: IntegrityAiDocument[],
) {
	return executeBatchWithFallback(documents, {
		maxBatchSizeBytes: MAX_BATCH_SIZE_BYTES,
		callBatch: callIntegrityAiBatch,
		fallbackConcurrency: AI_FALLBACK_CONCURRENCY,
		shouldFallback: (error) => !isRateLimitError(error),
		onBatchFailure: (batchError) =>
			console.warn("Batch document integrity analysis failed; using fallback", {
				documentCount: documents.length,
				error: errorMessage(batchError),
			}),
	});
}

async function validatePreparedDocumentBatch(params: {
	validationRunId: string;
	documents: PreparedValidationDocument[];
	opportunityId: string;
	registeredNames: string[];
	leadId: string | null;
}): Promise<PreparedValidationResult[]> {
	const eligibleForAi: IntegrityAiDocument[] = [];
	const retryErrors = new Map<
		string,
		{ message: string; code?: DocumentIntegrityError["code"] }
	>();
	const retryCounts = new Map<string, number>();
	for (const [index, document] of params.documents.entries()) {
		if (!document.buffer) continue;
		const bytes = scanPdfBytes(document.buffer);
		if (!(bytes.hasPdfHeader && (bytes.hasXref || bytes.eofCount > 0)))
			continue;
		const reference = `document_${index + 1}`;
		try {
			retryCounts.set(reference, await assertRetryAllowed(bytes.sha256));
			eligibleForAi.push({
				reference,
				buffer: document.buffer,
				filename: document.fileName,
			});
		} catch (error) {
			retryErrors.set(reference, {
				message: errorMessage(error),
				code: error instanceof DocumentIntegrityError ? error.code : undefined,
			});
		}
	}

	const { analyses, errors } =
		await callIntegrityAiBatchWithFallback(eligibleForAi);
	const results: PreparedValidationResult[] = [];
	for (const [index, document] of params.documents.entries()) {
		const reference = `document_${index + 1}`;
		const retryError = retryErrors.get(reference);
		if (retryError) {
			results.push({
				validation: null,
				error: retryError.message,
				errorCode: retryError.code,
			});
			continue;
		}
		try {
			const validation = await persistValidation({
				...document,
				validationRunId: params.validationRunId,
				opportunityId: params.opportunityId,
				registeredNames: params.registeredNames,
				leadId: params.leadId,
				prevalidatedRetryCount: retryCounts.get(reference),
				llm: analyses.get(reference),
				aiError: errors.get(reference),
			});
			results.push({ validation });
		} catch (error) {
			results.push({
				validation: null,
				error: errorMessage(error),
				errorCode:
					error instanceof DocumentIntegrityError ? error.code : undefined,
			});
		}
	}
	return results;
}

async function executeValidationRun(params: {
	documents: PreparedValidationDocument[];
	opportunityId: string;
	registeredNames: string[];
	leadId: string | null;
	validationSource: ValidationSource;
	requestedBy: string;
	rejectIfAnalysisCompleted?: boolean;
}) {
	const run = await createValidationRun(params);
	try {
		const results = await validatePreparedDocumentBatch({
			documents: params.documents,
			opportunityId: params.opportunityId,
			registeredNames: params.registeredNames,
			leadId: params.leadId,
			validationRunId: run.id,
		});
		const completedSuccessfully = isCompleteValidationRun(
			results,
			params.documents.length,
		);
		if (completedSuccessfully) {
			try {
				await freezeCompletedValidationEvidence({
					opportunityId: params.opportunityId,
					documents: params.documents,
					results,
				});
			} catch (error) {
				console.error("Could not preserve completed validation evidence", {
					runId: run.id,
					error: errorMessage(error),
				});
				throw new DocumentIntegrityError(
					"BAD_REQUEST",
					"No se pudo preparar una copia segura para la revisión manual. Intenta nuevamente.",
				);
			}
		}
		const completedAt = await finishValidationRun(
			run.id,
			completedSuccessfully ? "completed" : "error",
		);
		return results.map((result) => ({
			...result,
			validation: result.validation
				? { ...result.validation, validatedAt: completedAt }
				: null,
		}));
	} catch (error) {
		try {
			await finishValidationRun(run.id, "error");
		} catch (finishError) {
			console.error("Could not mark document validation run as failed", {
				runId: run.id,
				error: errorMessage(finishError),
			});
		}
		throw error;
	}
}

export async function validateUploadedBankStatements(params: {
	opportunityId: string;
	leadId: string;
	files: UploadedBankStatementInput[];
	userId: string;
	userRole: string;
}) {
	const context = await getOpportunityContext(params.opportunityId);
	if (context.leadId !== params.leadId) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"La oportunidad no pertenece al lead indicado",
		);
	}
	if (
		!canRunDocumentIntegrityValidation(params.userRole) ||
		!canWriteOpportunityCreditAnalysis(
			params.userRole,
			params.userId,
			context.assignedTo,
		)
	) {
		throw new DocumentIntegrityError(
			"FORBIDDEN",
			"No tienes permiso para validar esta oportunidad",
		);
	}
	const expectedPrefix = buildUploadPrefix(
		"bank_statement",
		params.opportunityId,
	);
	const prepared = await Promise.all(
		params.files.map(async (file, index) => {
			const documentType: BankStatementDocumentType =
				(["estados_cuenta_1", "estados_cuenta_2", "estados_cuenta_3"] as const)[
					index
				] ?? "other";
			try {
				const uploaded = await verifyUploadedDocumentInR2({
					key: file.key,
					expectedPrefix,
					filename: file.name,
					mimeType: file.mimeType,
					maxSizeBytes: MAX_DOCUMENT_INTEGRITY_FILE_SIZE_BYTES,
				});
				const buffer = await getFileBuffer(uploaded.key);
				return {
					documentType,
					filePath: uploaded.key,
					fileName: file.name,
					buffer,
				} satisfies PreparedValidationDocument;
			} catch (error) {
				if (error instanceof DocumentIntegrityError) throw error;
				// El key lo suministra el cliente y aqui ya fallo la verificacion de
				// prefijo, asi que no puede persistirse: getFileUrl firmaria una ruta
				// ajena. Se guarda un centinela que ningun prefijo valido produce.
				return {
					documentType,
					filePath: `unverified://${params.opportunityId}/${index + 1}`,
					fileName: file.name,
					buffer: null,
					storageError: errorMessage(error),
				} satisfies PreparedValidationDocument;
			}
		}),
	);
	// Un lote a medias haria que Gemini analice el resto y el run quede en error,
	// que no consume cupo: repetirlo con un archivo invalido rinde analisis pagados
	// sin gastar intentos.
	const unreadableFiles = prepared.filter((document) => !document.buffer);
	if (unreadableFiles.length > 0) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			`No se pudo leer ${unreadableFiles
				.map((document) => document.fileName)
				.join(", ")}. Vuelve a cargar los archivos e intenta de nuevo.`,
		);
	}
	const results = await executeValidationRun({
		documents: prepared,
		opportunityId: params.opportunityId,
		registeredNames: context.registeredNames,
		leadId: context.leadId,
		validationSource: "analisis_capacidad",
		requestedBy: params.userId,
		rejectIfAnalysisCompleted: true,
	});
	return results.map((result, index) => {
		if (result.validation)
			return {
				file: params.files[index].name,
				fileKey: result.validation.documentFilePath,
				validation: result.validation,
			};
		return {
			file: params.files[index].name,
			fileKey: params.files[index].key,
			validation: null,
			error: result.error,
		};
	});
}

export async function validateExistingOpportunityDocuments(params: {
	documentIds: string[];
	userId: string;
}) {
	const documents = await db
		.select({
			id: opportunityDocuments.id,
			opportunityId: opportunityDocuments.opportunityId,
			documentType: opportunityDocuments.documentType,
			filePath: opportunityDocuments.filePath,
			filename: opportunityDocuments.originalName,
			description: opportunityDocuments.description,
		})
		.from(opportunityDocuments)
		.where(inArray(opportunityDocuments.id, params.documentIds));
	if (documents.length !== params.documentIds.length)
		throw new DocumentIntegrityError(
			"NOT_FOUND",
			"Uno o más documentos no fueron encontrados",
		);
	if (new Set(documents.map((document) => document.opportunityId)).size !== 1)
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"Todos los documentos deben pertenecer a la misma oportunidad",
		);
	const documentsById = new Map(
		documents.map((document) => [document.id, document]),
	);
	const orderedDocuments = params.documentIds.map((documentId) => {
		const document = documentsById.get(documentId);
		if (!document)
			throw new DocumentIntegrityError("NOT_FOUND", "Documento no encontrado");
		const isBankStatement =
			[
				"estados_cuenta_1",
				"estados_cuenta_2",
				"estados_cuenta_3",
				"bank_statement",
			].includes(document.documentType) ||
			(document.documentType === "other" &&
				document.description?.startsWith("Estado de cuenta"));
		if (!isBankStatement)
			throw new DocumentIntegrityError(
				"BAD_REQUEST",
				"Solo se pueden validar estados de cuenta",
			);
		return document;
	});
	const opportunityId = orderedDocuments[0].opportunityId;
	const context = await getOpportunityContext(opportunityId);
	const prepared = await Promise.all(
		orderedDocuments.map(async (document) => {
			try {
				return {
					opportunityDocumentId: document.id,
					documentType: document.documentType as BankStatementDocumentType,
					filePath: document.filePath,
					fileName: document.filename,
					buffer: await getFileBuffer(document.filePath),
				} satisfies PreparedValidationDocument;
			} catch (error) {
				return {
					opportunityDocumentId: document.id,
					documentType: document.documentType as BankStatementDocumentType,
					filePath: document.filePath,
					fileName: document.filename,
					buffer: null,
					storageError: errorMessage(error),
				} satisfies PreparedValidationDocument;
			}
		}),
	);
	const results = await executeValidationRun({
		documents: prepared,
		opportunityId,
		registeredNames: context.registeredNames,
		leadId: context.leadId,
		validationSource: "documentacion",
		requestedBy: params.userId,
	});
	return results.map((result, index) => {
		return {
			opportunityDocumentId: orderedDocuments[index].id,
			validation: result.validation,
			error: result.error,
			errorCode: result.errorCode,
		};
	});
}

interface UploadedBankStatementsValidationParams {
	opportunityId: string;
	validationIds: string[];
	files: Array<{ filePath: string; contentSha256: string }>;
}

async function assertUploadedBankStatementsValidatedWithTransaction(
	tx: Transaction,
	params: UploadedBankStatementsValidationParams,
) {
	const [reset] = await tx
		.select({
			attemptNumber: sql<number>`coalesce(max(${documentIntegrityValidationResets.resetAfterAttemptNumber}), 0)::int`,
		})
		.from(documentIntegrityValidationResets)
		.where(
			eq(documentIntegrityValidationResets.opportunityId, params.opportunityId),
		);
	const resetAfterAttemptNumber = reset?.attemptNumber ?? 0;
	const [latestRun] = await tx
		.select({
			id: documentIntegrityValidationRuns.id,
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			status: documentIntegrityValidationRuns.status,
		})
		.from(documentIntegrityValidationRuns)
		.where(
			and(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
				gt(
					documentIntegrityValidationRuns.attemptNumber,
					resetAfterAttemptNumber,
				),
			),
		)
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(1);
	const uniqueValidationIds = [...new Set(params.validationIds)];
	if (
		uniqueValidationIds.length !== params.validationIds.length ||
		new Set(params.files.map((file) => file.filePath)).size !==
			params.files.length ||
		uniqueValidationIds.length !== params.files.length
	) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"Cada archivo debe tener una validación documental propia antes del análisis.",
		);
	}

	const validations = await tx
		.select({
			id: documentIntegrityValidations.id,
			validationRunId: documentIntegrityValidations.validationRunId,
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			filePath: documentIntegrityValidations.documentFilePath,
			contentSha256: documentIntegrityValidations.contentSha256,
			autoResult: documentIntegrityValidations.autoResult,
			manualApprovalId: documentIntegrityValidationApprovals.id,
		})
		.from(documentIntegrityValidations)
		.innerJoin(
			documentIntegrityValidationRuns,
			eq(
				documentIntegrityValidations.validationRunId,
				documentIntegrityValidationRuns.id,
			),
		)
		.leftJoin(
			documentIntegrityValidationApprovals,
			eq(
				documentIntegrityValidationApprovals.validationId,
				documentIntegrityValidations.id,
			),
		)
		.where(
			and(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
				eq(documentIntegrityValidationRuns.status, "completed"),
				inArray(documentIntegrityValidations.id, uniqueValidationIds),
			),
		);
	if (
		validations.some(
			(validation) => validation.attemptNumber <= resetAfterAttemptNumber,
		)
	) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"El cupo de validaciones documentales fue reiniciado. Vuelve a validar estos documentos antes de analizar la capacidad de pago.",
		);
	}
	const selectedRunIds = new Set(
		validations.map((validation) => validation.validationRunId),
	);
	if (
		latestRun &&
		validations.length === uniqueValidationIds.length &&
		selectedRunIds.size === 1 &&
		!selectedRunIds.has(latestRun.id)
	) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"Existe una validación documental más reciente. Actualiza la pantalla y utiliza el último lote validado.",
		);
	}
	const [latestRunValidationTotals] = latestRun
		? await tx
				.select({
					count: sql<number>`count(*)::int`,
				})
				.from(documentIntegrityValidations)
				.where(eq(documentIntegrityValidations.validationRunId, latestRun.id))
		: [{ count: 0 }];
	if (
		!latestRun ||
		latestRun.status !== "completed" ||
		validations.length !== latestRunValidationTotals.count ||
		!uploadedValidationPairsMatch({
			validationIds: params.validationIds,
			files: params.files,
			validations: validations.filter(
				(validation) =>
					validation.attemptNumber > resetAfterAttemptNumber &&
					validation.validationRunId === latestRun.id,
			),
		})
	) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"Los archivos del análisis no coinciden con la validación documental realizada.",
		);
	}
	const rejectedDocumentCount = getRejectedDocumentCount(validations);
	if (rejectedDocumentCount > 0) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			`${rejectedDocumentCount} documento${rejectedDocumentCount === 1 ? " fue rechazado" : "s fueron rechazados"}. Solicita documentos válidos y realiza una nueva validación documental antes de analizar la capacidad de pago.`,
		);
	}
	const pendingManualApprovalCount = getPendingManualApprovalCount(validations);
	if (pendingManualApprovalCount > 0) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			`${pendingManualApprovalCount} documento${pendingManualApprovalCount === 1 ? " requiere" : "s requieren"} aprobación manual antes de analizar la capacidad de pago.`,
		);
	}
}

export async function reserveCapacityAnalysis(params: {
	opportunityId: string;
	leadId: string;
	validationIds: string[];
	files: Array<{ filePath: string; contentSha256: string }>;
	userId: string;
	maxAttempts: number;
}) {
	return db.transaction(async (tx) => {
		await tx.execute(lockOpportunity(params.opportunityId));
		await assertNoActiveCapacityAnalysis(tx, params.opportunityId);
		const [existingAnalysis] = await tx
			.select({
				id: creditAnalysis.id,
				attemptCount: creditAnalysis.attemptCount,
				analyzedAt: creditAnalysis.analyzedAt,
			})
			.from(creditAnalysis)
			.where(eq(creditAnalysis.opportunityId, params.opportunityId))
			.limit(1);
		if (existingAnalysis?.analyzedAt) {
			throw new DocumentIntegrityError(
				"BAD_REQUEST",
				"Esta oportunidad ya tiene un análisis de capacidad de pago completado.",
			);
		}
		if ((existingAnalysis?.attemptCount ?? 0) >= params.maxAttempts) {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				`Se alcanzó el límite de ${params.maxAttempts} intentos de análisis. Contacte al administrador.`,
			);
		}

		await assertUploadedBankStatementsValidatedWithTransaction(tx, params);
		const token = randomUUID();
		const startedAt = new Date();
		const [reserved] = existingAnalysis
			? await tx
					.update(creditAnalysis)
					.set({
						attemptCount: sql`${creditAnalysis.attemptCount} + 1`,
						analysisReservationToken: token,
						analysisReservationStartedAt: startedAt,
						updatedAt: startedAt,
					})
					.where(
						and(
							eq(creditAnalysis.id, existingAnalysis.id),
							isNull(creditAnalysis.analysisReservationToken),
							isNull(creditAnalysis.analyzedAt),
							lt(creditAnalysis.attemptCount, params.maxAttempts),
						),
					)
					.returning({ attemptCount: creditAnalysis.attemptCount })
			: await tx
					.insert(creditAnalysis)
					.values({
						leadId: params.leadId,
						opportunityId: params.opportunityId,
						attemptCount: 1,
						createdBy: params.userId,
						analysisReservationToken: token,
						analysisReservationStartedAt: startedAt,
					})
					.onConflictDoNothing()
					.returning({ attemptCount: creditAnalysis.attemptCount });
		if (!reserved) {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				"No se pudo reservar el análisis de capacidad. Actualiza la pantalla e inténtalo nuevamente.",
			);
		}
		return { token, attemptCount: reserved.attemptCount };
	});
}

export async function releaseCapacityAnalysisReservation(params: {
	opportunityId: string;
	token: string;
}) {
	await db
		.update(creditAnalysis)
		.set({
			analysisReservationToken: null,
			analysisReservationStartedAt: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(creditAnalysis.opportunityId, params.opportunityId),
				eq(creditAnalysis.analysisReservationToken, params.token),
			),
		);
}

export async function resetOpportunityCreditAnalysis(params: {
	opportunityId: string;
	leadId: string;
}) {
	return db.transaction(async (tx) => {
		await tx.execute(lockOpportunity(params.opportunityId));
		await assertNoActiveCapacityAnalysis(tx, params.opportunityId);
		const [deleted] = await tx
			.delete(creditAnalysis)
			.where(
				and(
					eq(creditAnalysis.opportunityId, params.opportunityId),
					eq(creditAnalysis.leadId, params.leadId),
				),
			)
			.returning({ id: creditAnalysis.id });
		return deleted ?? null;
	});
}

export async function upsertOpportunityCreditAnalysis(params: {
	opportunityId: string;
	leadId: string;
	userId: string;
	analysisData: {
		monthlyFixedIncome?: string;
		monthlyVariableIncome?: string;
		monthlyFixedExpenses?: string;
		monthlyVariableExpenses?: string;
		economicAvailability?: string;
		maxPayment?: string;
		maxCreditAmount?: string;
	};
}) {
	return db.transaction(async (tx) => {
		await tx.execute(lockOpportunity(params.opportunityId));
		await assertNoActiveCapacityAnalysis(tx, params.opportunityId);
		const [existing] = await tx
			.select({
				id: creditAnalysis.id,
				analyzedAt: creditAnalysis.analyzedAt,
			})
			.from(creditAnalysis)
			.where(
				and(
					eq(creditAnalysis.opportunityId, params.opportunityId),
					eq(creditAnalysis.leadId, params.leadId),
				),
			)
			.limit(1);
		if (existing) {
			const [updated] = await tx
				.update(creditAnalysis)
				.set({
					...params.analysisData,
					analyzedAt: existing.analyzedAt ?? new Date(),
					updatedAt: new Date(),
				})
				.where(eq(creditAnalysis.id, existing.id))
				.returning();
			return updated;
		}

		const [created] = await tx
			.insert(creditAnalysis)
			.values({
				leadId: params.leadId,
				opportunityId: params.opportunityId,
				...params.analysisData,
				createdBy: params.userId,
				analyzedAt: new Date(),
			})
			.returning();
		return created;
	});
}

export async function approveDocumentIntegrityValidation(params: {
	validationId: string;
	reason: string;
	userId: string;
	userRole: string;
}) {
	if (!canApproveDocumentIntegrityValidation(params.userRole)) {
		throw new DocumentIntegrityError(
			"FORBIDDEN",
			"Solo administradores y supervisores de ventas pueden aprobar documentos",
		);
	}
	const reason = params.reason.trim();
	if (reason.length < 5 || reason.length > 1000)
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"La justificación debe tener entre 5 y 1,000 caracteres",
		);

	return db.transaction(async (tx) => {
		const [validation] = await tx
			.select({
				id: documentIntegrityValidations.id,
				autoResult: documentIntegrityValidations.autoResult,
				validationRunId: documentIntegrityValidations.validationRunId,
				runStatus: documentIntegrityValidationRuns.status,
				attemptNumber: documentIntegrityValidationRuns.attemptNumber,
				opportunityId: documentIntegrityValidationRuns.opportunityId,
				opportunityAssignedTo: opportunities.assignedTo,
				existingApprovalId: documentIntegrityValidationApprovals.id,
			})
			.from(documentIntegrityValidations)
			.innerJoin(
				documentIntegrityValidationRuns,
				eq(
					documentIntegrityValidations.validationRunId,
					documentIntegrityValidationRuns.id,
				),
			)
			.innerJoin(
				opportunities,
				eq(documentIntegrityValidationRuns.opportunityId, opportunities.id),
			)
			.leftJoin(
				documentIntegrityValidationApprovals,
				eq(
					documentIntegrityValidationApprovals.validationId,
					documentIntegrityValidations.id,
				),
			)
			.where(eq(documentIntegrityValidations.id, params.validationId))
			.limit(1);
		if (!validation)
			throw new DocumentIntegrityError("NOT_FOUND", "Validación no encontrada");

		await tx.execute(lockOpportunity(validation.opportunityId));
		await assertNoActiveCapacityAnalysis(tx, validation.opportunityId);

		if (
			!canWriteOpportunityCreditAnalysis(
				params.userRole,
				params.userId,
				validation.opportunityAssignedTo,
			)
		) {
			throw new DocumentIntegrityError(
				"FORBIDDEN",
				"No tienes permiso para aprobar documentos de esta oportunidad",
			);
		}
		const [latestReset] = await tx
			.select({
				attemptNumber: sql<number>`coalesce(max(${documentIntegrityValidationResets.resetAfterAttemptNumber}), 0)::int`,
			})
			.from(documentIntegrityValidationResets)
			.where(
				eq(
					documentIntegrityValidationResets.opportunityId,
					validation.opportunityId,
				),
			);
		const resetAfterAttemptNumber = latestReset?.attemptNumber ?? 0;
		const [latestRun] = await tx
			.select({
				id: documentIntegrityValidationRuns.id,
				status: documentIntegrityValidationRuns.status,
			})
			.from(documentIntegrityValidationRuns)
			.where(
				eq(
					documentIntegrityValidationRuns.opportunityId,
					validation.opportunityId,
				),
			)
			.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
			.limit(1);
		const availability = getManualApprovalAvailability({
			autoResult: validation.autoResult,
			validationRunId: validation.validationRunId,
			runStatus: validation.runStatus,
			attemptNumber: validation.attemptNumber,
			resetAfterAttemptNumber,
			latestRunId: latestRun?.id,
			latestRunStatus: latestRun?.status,
		});
		if (!availability.allowed) {
			throw new DocumentIntegrityError(
				"BAD_REQUEST",
				availability.reason === "wrong_result"
					? "Solo se pueden aprobar documentos enviados a revisión manual"
					: "Solo puede aprobar documentos de la última validación completada del ciclo vigente",
			);
		}
		if (validation.existingApprovalId)
			throw new DocumentIntegrityError(
				"BAD_REQUEST",
				"Este documento ya fue aprobado manualmente",
			);

		const [approval] = await tx
			.insert(documentIntegrityValidationApprovals)
			.values({
				validationId: validation.id,
				approvedBy: params.userId,
				reason,
			})
			.onConflictDoNothing()
			.returning({
				id: documentIntegrityValidationApprovals.id,
				reason: documentIntegrityValidationApprovals.reason,
				approvedAt: documentIntegrityValidationApprovals.approvedAt,
				approvedBy: documentIntegrityValidationApprovals.approvedBy,
			});
		if (!approval)
			throw new DocumentIntegrityError(
				"BAD_REQUEST",
				"Este documento ya fue aprobado manualmente",
			);
		const [approver] = await tx
			.select({ name: user.name, email: user.email })
			.from(user)
			.where(eq(user.id, approval.approvedBy))
			.limit(1);

		return {
			id: approval.id,
			reason: approval.reason,
			approvedAt: approval.approvedAt,
			approvedByName: approver?.name ?? "",
			approvedByEmail: approver?.email ?? "",
		};
	});
}

export async function linkUploadedValidationsToDocuments(params: {
	opportunityId: string;
	links: Array<{
		documentId: string;
		documentFilePath: string;
		sourceFilePath: string;
		buffer: Buffer;
	}>;
}) {
	return db.transaction(async (tx) => {
		const sourceFilePathsToDelete = new Set<string>();
		const bankStatementPrefix = buildUploadPrefix(
			"bank_statement",
			params.opportunityId,
		);
		const linksBySource = new Map<string, typeof params.links>();
		for (const link of params.links) {
			const groupedLinks = linksBySource.get(link.sourceFilePath) ?? [];
			groupedLinks.push(link);
			linksBySource.set(link.sourceFilePath, groupedLinks);
		}
		for (const [sourceFilePath, links] of linksBySource) {
			const primaryLink = links[0];
			if (!primaryLink) continue;
			const sha256 = scanPdfBytes(primaryLink.buffer).sha256;
			const [candidate] = await tx
				.select({ id: documentIntegrityValidations.id })
				.from(documentIntegrityValidations)
				.innerJoin(
					documentIntegrityValidationRuns,
					eq(
						documentIntegrityValidations.validationRunId,
						documentIntegrityValidationRuns.id,
					),
				)
				.where(
					and(
						eq(
							documentIntegrityValidationRuns.opportunityId,
							params.opportunityId,
						),
						eq(documentIntegrityValidations.contentSha256, sha256),
						eq(documentIntegrityValidations.documentFilePath, sourceFilePath),
						eq(documentIntegrityValidationRuns.status, "completed"),
					),
				)
				.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
				.limit(1);
			if (!candidate) continue;
			const preserveEvidence = isImmutableDocumentIntegrityEvidencePath({
				filePath: sourceFilePath,
				bankStatementPrefix,
			});
			// El bridge registra todos los documentos definitivos asociados. La copia
			// congelada, en cambio, sigue siendo la evidencia exacta que vio y aprobó
			// el supervisor: no se reapunta ni se entrega al cleanup de temporales.
			if (!preserveEvidence) {
				await tx
					.update(documentIntegrityValidations)
					.set({
						documentFilePath: primaryLink.documentFilePath,
					})
					.where(eq(documentIntegrityValidations.id, candidate.id));
			}
			await tx.insert(documentIntegrityValidationDocuments).values(
				links.map((link) => ({
					validationId: candidate.id,
					opportunityDocumentId: link.documentId,
					linkedFilePath: link.documentFilePath,
				})),
			);
			if (!preserveEvidence) sourceFilePathsToDelete.add(sourceFilePath);
		}
		return [...sourceFilePathsToDelete];
	});
}

export async function getDocumentIntegrityStatuses(params: {
	opportunityId: string;
	salesUserId?: string;
}) {
	const conditions = [
		eq(opportunityDocuments.opportunityId, params.opportunityId),
	];
	if (params.salesUserId)
		conditions.push(eq(opportunities.assignedTo, params.salesUserId));
	const documents = await db
		.select({
			id: opportunityDocuments.id,
			documentType: opportunityDocuments.documentType,
			filePath: opportunityDocuments.filePath,
			description: opportunityDocuments.description,
		})
		.from(opportunityDocuments)
		.innerJoin(
			opportunities,
			eq(opportunityDocuments.opportunityId, opportunities.id),
		)
		.where(and(...conditions));
	const bankDocuments = documents.filter(
		(document) =>
			[
				"estados_cuenta_1",
				"estados_cuenta_2",
				"estados_cuenta_3",
				"bank_statement",
			].includes(document.documentType) ||
			(document.documentType === "other" &&
				document.description?.startsWith("Estado de cuenta")),
	);
	if (bankDocuments.length === 0) return [];

	const rows = await db
		.selectDistinctOn(
			[documentIntegrityValidationDocuments.opportunityDocumentId],
			{
				opportunityDocumentId:
					documentIntegrityValidationDocuments.opportunityDocumentId,
				documentType: documentIntegrityValidations.documentType,
				autoResult: documentIntegrityValidations.autoResult,
				isCurrentCompletedRun: sql<boolean>`(
					${documentIntegrityValidationRuns.status} = 'completed'
					and ${documentIntegrityValidationRuns.id} = (
						select current_run.id
						from document_integrity_validation_runs current_run
						where current_run.opportunity_id = ${params.opportunityId}
							and current_run.attempt_number > coalesce((
								select max(current_reset.reset_after_attempt_number)
								from document_integrity_validation_resets current_reset
								where current_reset.opportunity_id = ${params.opportunityId}
							), 0)
						order by current_run.attempt_number desc
						limit 1
					)
				)`,
				validatedAt: sql<Date>`coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt})`,
				linkedFilePath: documentIntegrityValidationDocuments.linkedFilePath,
				manualApprovalId: documentIntegrityValidationApprovals.id,
				signalCount: sql<number>`(
					select count(*)::int
					from jsonb_array_elements(${documentIntegrityValidations.signals}) as signal
					where signal->>'code' <> 'identidad_comparada'
				)`,
			},
		)
		.from(documentIntegrityValidationDocuments)
		.innerJoin(
			documentIntegrityValidations,
			eq(
				documentIntegrityValidationDocuments.validationId,
				documentIntegrityValidations.id,
			),
		)
		.innerJoin(
			documentIntegrityValidationRuns,
			eq(
				documentIntegrityValidations.validationRunId,
				documentIntegrityValidationRuns.id,
			),
		)
		.leftJoin(
			documentIntegrityValidationApprovals,
			eq(
				documentIntegrityValidationApprovals.validationId,
				documentIntegrityValidations.id,
			),
		)
		.where(
			inArray(
				documentIntegrityValidationDocuments.opportunityDocumentId,
				bankDocuments.map((document) => document.id),
			),
		)
		.orderBy(
			documentIntegrityValidationDocuments.opportunityDocumentId,
			desc(documentIntegrityValidationRuns.attemptNumber),
		);
	const currentPaths = new Map(
		bankDocuments.map((document) => [document.id, document.filePath]),
	);
	return rows.map((row) => ({
		opportunityDocumentId: row.opportunityDocumentId,
		documentType: row.documentType,
		result: row.autoResult,
		manuallyApproved:
			row.autoResult === "revision_manual" && !!row.manualApprovalId,
		validatedAt: row.validatedAt,
		isStale:
			!row.isCurrentCompletedRun ||
			currentPaths.get(row.opportunityDocumentId) !== row.linkedFilePath,
		signalCount: row.signalCount,
	}));
}

export async function getDocumentIntegrityAttemptStatus(params: {
	opportunityId: string;
	salesUserId?: string;
}) {
	const opportunityConditions = [eq(opportunities.id, params.opportunityId)];
	if (params.salesUserId)
		opportunityConditions.push(
			eq(opportunities.assignedTo, params.salesUserId),
		);
	const [opportunity] = await db
		.select({ id: opportunities.id })
		.from(opportunities)
		.where(and(...opportunityConditions))
		.limit(1);
	if (!opportunity)
		throw new DocumentIntegrityError("NOT_FOUND", "Oportunidad no encontrada");

	const resetAfterAttemptNumber = await getLatestResetAttemptNumber(
		params.opportunityId,
	);
	const runs = await db
		.select({
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			status: documentIntegrityValidationRuns.status,
			startedAt: documentIntegrityValidationRuns.startedAt,
		})
		.from(documentIntegrityValidationRuns)
		.where(
			eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
		);
	return getAttemptStatus({
		runs,
		resetAfterAttemptNumber,
		maxAttempts: MAX_DOCUMENT_INTEGRITY_ATTEMPTS,
		maxRunsPerCycle: MAX_RUNS_PER_CYCLE,
		staleAfterMs: RUN_STALE_AFTER_MS,
	});
}

export async function getLatestReusableDocumentIntegrityRun(params: {
	opportunityId: string;
	salesUserId?: string;
}) {
	await getDocumentIntegrityAttemptStatus(params);
	const resetAfterAttemptNumber = await getLatestResetAttemptNumber(
		params.opportunityId,
	);
	const [run] = await db
		.select({
			id: documentIntegrityValidationRuns.id,
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			status: documentIntegrityValidationRuns.status,
			validationSource: documentIntegrityValidationRuns.validationSource,
			startedAt: documentIntegrityValidationRuns.startedAt,
			completedAt: documentIntegrityValidationRuns.completedAt,
		})
		.from(documentIntegrityValidationRuns)
		.where(
			and(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
				gt(
					documentIntegrityValidationRuns.attemptNumber,
					resetAfterAttemptNumber,
				),
			),
		)
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(1);
	if (
		!run ||
		run.status !== "completed" ||
		run.validationSource !== "analisis_capacidad"
	)
		return null;

	const validations = await db
		.select({
			id: documentIntegrityValidations.id,
			hasLinkedDocuments: sql<boolean>`exists (
				select 1
				from document_integrity_validation_documents linked_document
				where linked_document.validation_id = ${documentIntegrityValidations.id}
			)`,
			documentType: documentIntegrityValidations.documentType,
			filePath: documentIntegrityValidations.documentFilePath,
			result: documentIntegrityValidations.autoResult,
			reason: documentIntegrityValidations.autoReason,
			signals: documentIntegrityValidations.signals,
			manualApprovalId: documentIntegrityValidationApprovals.id,
			manualApprovalReason: documentIntegrityValidationApprovals.reason,
			manualApprovedAt: documentIntegrityValidationApprovals.approvedAt,
			manualApprovedByName: user.name,
			manualApprovedByEmail: user.email,
		})
		.from(documentIntegrityValidations)
		.leftJoin(
			documentIntegrityValidationApprovals,
			eq(
				documentIntegrityValidationApprovals.validationId,
				documentIntegrityValidations.id,
			),
		)
		.leftJoin(
			user,
			eq(documentIntegrityValidationApprovals.approvedBy, user.id),
		)
		.where(eq(documentIntegrityValidations.validationRunId, run.id))
		.orderBy(documentIntegrityValidations.documentType);
	const expectedPrefix = buildUploadPrefix(
		"bank_statement",
		params.opportunityId,
	);
	if (
		validations.length === 0 ||
		validations.some(
			(validation) =>
				validation.result === "error" ||
				validation.hasLinkedDocuments ||
				!validation.filePath.startsWith(`${expectedPrefix}/`),
		)
	)
		return null;

	return {
		opportunityId: params.opportunityId,
		runId: run.id,
		attemptNumber: run.attemptNumber,
		completedAt: run.completedAt,
		payloads: validations.map((validation) => ({
			name: originalNameFromDocumentIntegrityPath(validation.filePath),
			key: validation.filePath,
			mimeType: "application/pdf",
		})),
		results: validations.map((validation) => ({
			file: originalNameFromDocumentIntegrityPath(validation.filePath),
			validation: {
				id: validation.id,
				result: validation.result,
				reason: validation.reason,
				recommendedAction: buildDocumentRecommendedAction({
					result: validation.result,
					signals: validation.signals,
				}),
				validatedAt: run.completedAt ?? run.startedAt,
				manualApproval:
					validation.manualApprovalId && validation.manualApprovedAt
						? {
								id: validation.manualApprovalId,
								reason: validation.manualApprovalReason ?? "",
								approvedAt: validation.manualApprovedAt,
								approvedByName: validation.manualApprovedByName ?? "",
								approvedByEmail: validation.manualApprovedByEmail ?? "",
							}
						: null,
			},
		})),
	};
}

export async function listDocumentIntegrityValidations(params: {
	search?: string;
	opportunityId?: string;
	requiresReviewOnly: boolean;
	limit: number;
	offset: number;
}) {
	const latestFinalizedRun = sql`
		${documentIntegrityValidationRuns.id} = (
			select latest_run.id
			from document_integrity_validation_runs latest_run
			where latest_run.opportunity_id = ${documentIntegrityValidationRuns.opportunityId}
				and latest_run.status in ('completed', 'error')
			order by latest_run.attempt_number desc
			limit 1
		)`;
	const conditions = [latestFinalizedRun];
	if (params.opportunityId)
		conditions.push(
			eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
		);
	const havingConditions = [];
	if (params.requiresReviewOnly)
		havingConditions.push(
			sql<boolean>`bool_or(
				${documentIntegrityValidationRuns.status} = 'error'
					or ${documentIntegrityValidations.autoResult} = 'error'
					or ${documentIntegrityValidations.autoResult} = 'rechazado'
					or (
						${documentIntegrityValidations.autoResult} = 'revision_manual'
							and ${documentIntegrityValidationApprovals.id} is null
					)
			)`,
		);
	if (params.search) {
		const pattern = `%${params.search}%`;
		havingConditions.push(
			sql<boolean>`bool_or(
				${opportunities.title} ilike ${pattern}
				or ${leads.firstName} ilike ${pattern}
				or ${leads.lastName} ilike ${pattern}
				or exists (
					select 1
					from document_integrity_validation_documents linked_document
					inner join opportunity_documents linked_opportunity_document
						on linked_opportunity_document.id = linked_document.opportunity_document_id
					where linked_document.validation_id = ${documentIntegrityValidations.id}
						and linked_opportunity_document.original_name ilike ${pattern}
				)
				or ${documentIntegrityValidations.documentFilePath} ilike ${pattern}
			)`,
		);
	}
	return db
		.select({
			opportunityId: documentIntegrityValidationRuns.opportunityId,
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			opportunityTitle: opportunities.title,
			leadFirstName: leads.firstName,
			leadLastName: leads.lastName,
			latestValidatedAt: sql<Date>`max(coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt}))`,
			documentCount: sql<number>`count(distinct ${documentIntegrityValidations.id})::int`,
			aggregateResult: sql<
				"valido" | "observacion" | "revision_manual" | "rechazado" | "error"
			>`case
				when bool_or(${documentIntegrityValidationRuns.status} = 'error') then 'error'
				when bool_or(${documentIntegrityValidations.autoResult} = 'rechazado') then 'rechazado'
				when bool_or(${documentIntegrityValidations.autoResult} = 'error') then 'error'
				when bool_or(${documentIntegrityValidations.autoResult} = 'revision_manual') then 'revision_manual'
				when bool_or(${documentIntegrityValidations.autoResult} = 'observacion') then 'observacion'
				else 'valido'
			end`,
		})
		.from(documentIntegrityValidationRuns)
		.leftJoin(
			documentIntegrityValidations,
			eq(
				documentIntegrityValidationRuns.id,
				documentIntegrityValidations.validationRunId,
			),
		)
		.leftJoin(
			documentIntegrityValidationApprovals,
			eq(
				documentIntegrityValidationApprovals.validationId,
				documentIntegrityValidations.id,
			),
		)
		.innerJoin(
			opportunities,
			eq(documentIntegrityValidationRuns.opportunityId, opportunities.id),
		)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(conditions.length ? and(...conditions) : undefined)
		.groupBy(
			documentIntegrityValidationRuns.opportunityId,
			documentIntegrityValidationRuns.id,
			documentIntegrityValidationRuns.attemptNumber,
			opportunities.title,
			leads.firstName,
			leads.lastName,
		)
		.having(havingConditions.length ? and(...havingConditions) : undefined)
		.orderBy(
			sql`max(coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt})) desc`,
		)
		.limit(params.limit)
		.offset(params.offset);
}

export async function getDocumentIntegrityValidationGroup(params: {
	opportunityId?: string;
	validationId?: string;
	salesUserId?: string;
	userRole: string;
}) {
	let opportunityId = params.opportunityId;
	if (!opportunityId && params.validationId) {
		const [validation] = await db
			.select({
				opportunityId: documentIntegrityValidationRuns.opportunityId,
			})
			.from(documentIntegrityValidations)
			.innerJoin(
				documentIntegrityValidationRuns,
				eq(
					documentIntegrityValidations.validationRunId,
					documentIntegrityValidationRuns.id,
				),
			)
			.where(eq(documentIntegrityValidations.id, params.validationId))
			.limit(1);
		if (!validation)
			throw new DocumentIntegrityError("NOT_FOUND", "Validación no encontrada");
		opportunityId = validation.opportunityId;
	}
	if (!opportunityId)
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"Indica la oportunidad que deseas consultar",
		);

	const [opportunity] = await db
		.select({
			opportunityId: opportunities.id,
			opportunityTitle: opportunities.title,
			leadFirstName: leads.firstName,
			leadLastName: leads.lastName,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(
			and(
				eq(opportunities.id, opportunityId),
				params.salesUserId
					? eq(opportunities.assignedTo, params.salesUserId)
					: undefined,
			),
		)
		.limit(1);
	if (!opportunity)
		throw new DocumentIntegrityError("NOT_FOUND", "Oportunidad no encontrada");
	const currentAttemptStatus = await getDocumentIntegrityAttemptStatus({
		opportunityId,
		salesUserId: params.salesUserId,
	});
	const resets = await db
		.select({
			resetAfterAttemptNumber:
				documentIntegrityValidationResets.resetAfterAttemptNumber,
			resetAt: documentIntegrityValidationResets.resetAt,
			resetByName: user.name,
			resetByEmail: user.email,
		})
		.from(documentIntegrityValidationResets)
		.innerJoin(user, eq(documentIntegrityValidationResets.resetBy, user.id))
		.where(eq(documentIntegrityValidationResets.opportunityId, opportunityId))
		.orderBy(documentIntegrityValidationResets.resetAfterAttemptNumber);
	const [latestFinalizedRun] = await db
		.select({
			id: documentIntegrityValidationRuns.id,
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			status: documentIntegrityValidationRuns.status,
			validationSource: documentIntegrityValidationRuns.validationSource,
			validatedAt: sql<Date>`coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt})`,
		})
		.from(documentIntegrityValidationRuns)
		.where(
			and(
				eq(documentIntegrityValidationRuns.opportunityId, opportunityId),
				inArray(documentIntegrityValidationRuns.status, ["completed", "error"]),
			),
		)
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(1);
	const [latestRun] = await db
		.select({
			id: documentIntegrityValidationRuns.id,
			status: documentIntegrityValidationRuns.status,
		})
		.from(documentIntegrityValidationRuns)
		.where(eq(documentIntegrityValidationRuns.opportunityId, opportunityId))
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(1);

	const rows = latestFinalizedRun
		? await db
				.select({
					id: documentIntegrityValidations.id,
					validationRunId: documentIntegrityValidations.validationRunId,
					opportunityDocumentId: sql<string | null>`(
						select linked_document.opportunity_document_id
						from document_integrity_validation_documents linked_document
						inner join opportunity_documents linked_opportunity_document
							on linked_opportunity_document.id = linked_document.opportunity_document_id
						where linked_document.validation_id = ${documentIntegrityValidations.id}
							and linked_opportunity_document.file_path = linked_document.linked_file_path
						order by linked_document.opportunity_document_id
						limit 1
					)`,
					documentType: documentIntegrityValidations.documentType,
					documentFilePath: documentIntegrityValidations.documentFilePath,
					linkedDocumentFilePath: sql<string | null>`(
						select linked_document.linked_file_path
						from document_integrity_validation_documents linked_document
						inner join opportunity_documents linked_opportunity_document
							on linked_opportunity_document.id = linked_document.opportunity_document_id
						where linked_document.validation_id = ${documentIntegrityValidations.id}
							and linked_opportunity_document.file_path = linked_document.linked_file_path
						order by linked_document.opportunity_document_id
						limit 1
					)`,
					contentSha256: documentIntegrityValidations.contentSha256,
					autoResult: documentIntegrityValidations.autoResult,
					autoScore: documentIntegrityValidations.autoScore,
					autoReason: documentIntegrityValidations.autoReason,
					signals: documentIntegrityValidations.signals,
					aiRawResponse: documentIntegrityValidations.aiRawResponse,
					validationSource: documentIntegrityValidationRuns.validationSource,
					attemptNumber: documentIntegrityValidationRuns.attemptNumber,
					validatedAt: sql<Date>`coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt})`,
					documentName: sql<string | null>`(
						select linked_opportunity_document.original_name
						from document_integrity_validation_documents linked_document
						inner join opportunity_documents linked_opportunity_document
							on linked_opportunity_document.id = linked_document.opportunity_document_id
						where linked_document.validation_id = ${documentIntegrityValidations.id}
							and linked_opportunity_document.file_path = linked_document.linked_file_path
						order by linked_document.opportunity_document_id
						limit 1
					)`,
					manualApprovalId: documentIntegrityValidationApprovals.id,
					manualApprovalReason: documentIntegrityValidationApprovals.reason,
					manualApprovedAt: documentIntegrityValidationApprovals.approvedAt,
					manualApprovedByName: user.name,
					manualApprovedByEmail: user.email,
				})
				.from(documentIntegrityValidations)
				.innerJoin(
					documentIntegrityValidationRuns,
					eq(
						documentIntegrityValidations.validationRunId,
						documentIntegrityValidationRuns.id,
					),
				)
				.leftJoin(
					documentIntegrityValidationApprovals,
					eq(
						documentIntegrityValidationApprovals.validationId,
						documentIntegrityValidations.id,
					),
				)
				.leftJoin(
					user,
					eq(documentIntegrityValidationApprovals.approvedBy, user.id),
				)
				.where(
					eq(
						documentIntegrityValidations.validationRunId,
						latestFinalizedRun.id,
					),
				)
		: [];

	// Defensa en profundidad: solo se firma lo que vive bajo un prefijo propio de
	// la oportunidad. Si alguna ruta no verificada llegara a persistirse, no se
	// convierte en una URL firmada.
	const signablePrefixes = [
		`${buildUploadPrefix("bank_statement", opportunityId)}/`,
		`${buildUploadPrefix("opportunity_document", opportunityId)}/`,
	];
	const immutableEvidencePrefix = `${buildUploadPrefix(
		"bank_statement",
		opportunityId,
	)}/validated/`;
	const validationDetails = await Promise.all(
		rows.map(async (row) => {
			const {
				documentFilePath,
				linkedDocumentFilePath,
				aiRawResponse,
				manualApprovalId,
				manualApprovalReason,
				manualApprovedAt,
				manualApprovedByName,
				manualApprovedByEmail,
				...details
			} = row;
			const positiveChecks = buildDocumentPositiveChecks({
				aiRawResponse,
				signals: row.signals,
			});
			const recommendedAction = buildDocumentRecommendedAction({
				result: row.autoResult,
				signals: row.signals,
			});
			const previewFilePath = documentFilePath.startsWith(
				immutableEvidencePrefix,
			)
				? documentFilePath
				: (linkedDocumentFilePath ?? documentFilePath);
			return {
				...details,
				signals: details.signals.filter(
					(signal) => signal.code !== "identidad_comparada",
				),
				positiveChecks,
				recommendedAction,
				manualApproval:
					manualApprovalId && manualApprovedAt
						? {
								id: manualApprovalId,
								reason: manualApprovalReason ?? "",
								approvedAt: manualApprovedAt,
								approvedByName: manualApprovedByName ?? "",
								approvedByEmail: manualApprovedByEmail ?? "",
							}
						: null,
				signedUrl: signablePrefixes.some((prefix) =>
					previewFilePath.startsWith(prefix),
				)
					? await getFileUrl(previewFilePath)
					: null,
			};
		}),
	);
	const validations = validationDetails;
	const attempts = latestFinalizedRun
		? [
				{
					validationRunId: latestFinalizedRun.id,
					attemptNumber: latestFinalizedRun.attemptNumber,
					status: latestFinalizedRun.status,
					validationSource: latestFinalizedRun.validationSource,
					validatedAt: latestFinalizedRun.validatedAt,
					validations,
				},
			]
		: [];
	const latestReset = resets.at(-1);
	const canApproveManual =
		canApproveDocumentIntegrityValidation(params.userRole) &&
		latestFinalizedRun?.status === "completed" &&
		latestRun?.status === "completed" &&
		latestRun.id === latestFinalizedRun.id &&
		latestFinalizedRun.attemptNumber >
			(latestReset?.resetAfterAttemptNumber ?? 0) &&
		!currentAttemptStatus.hasProcessingRun;

	return {
		...opportunity,
		...currentAttemptStatus,
		canApproveManual,
		reset: latestReset
			? {
					resetAfterAttemptNumber: latestReset.resetAfterAttemptNumber,
					resetAt: latestReset.resetAt,
					resetByName: latestReset.resetByName,
					resetByEmail: latestReset.resetByEmail,
				}
			: null,
		validations,
		attempts,
	};
}
