import { createHash } from "node:crypto";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import {
	and,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	ne,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import {
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
import { buildDocumentPositiveChecks } from "../lib/document-integrity/decision-evidence";
import { runDocumentIntegrityEngine } from "../lib/document-integrity/engine";
import {
	ESTADO_CUENTA_BATCH_PROMPT,
	estadoCuentaBatchAiSchema,
	normalizeStatementIdentifier,
} from "../lib/document-integrity/kinds/estado-cuenta";
import { scanPdfBytes } from "../lib/document-integrity/pdf-forensics";
import type { DocumentIntegrityAiResult } from "../lib/document-integrity/types";
import {
	getAttemptAvailability,
	getAttemptStatus,
	getResetAvailability,
	isCompleteValidationRun,
	uploadedValidationPairsMatch,
} from "../lib/document-integrity/workflow-policy";
import {
	buildUploadPrefix,
	getFileBuffer,
	getFileUrl,
	verifyUploadedDocumentInR2,
} from "../lib/storage";

export const DOC_INTEGRITY_MODEL =
	process.env.DOC_INTEGRITY_MODEL || "gemini-3-flash-preview";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_SIZE_BYTES = 45 * 1024 * 1024;
const AI_TIMEOUT_MS = 120_000;
const RETRY_WINDOW_MS = 5 * 60_000;
const RUN_STALE_AFTER_MS = AI_TIMEOUT_MS + 60_000;
export const MAX_DOCUMENT_INTEGRITY_ATTEMPTS = 2;
const MAX_ERROR_RUNS_IN_HISTORY = 3;

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

async function createValidationRun(params: {
	opportunityId: string;
	validationSource: ValidationSource;
	requestedBy: string;
}) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${params.opportunityId}))`,
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
				hasProcessingRun: sql<boolean>`coalesce(bool_or(${documentIntegrityValidationRuns.status} = 'processing'), false)`,
			})
			.from(documentIntegrityValidationRuns)
			.where(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
			);
		const availability = getAttemptAvailability({
			latestAttempt: attempts?.latest ?? 0,
			completedAttempts: attempts?.completed ?? 0,
			hasProcessingRun: attempts?.hasProcessingRun ?? false,
			maxAttempts: MAX_DOCUMENT_INTEGRITY_ATTEMPTS,
		});
		if (!availability.allowed && availability.reason === "processing") {
			throw new DocumentIntegrityError(
				"TOO_MANY_REQUESTS",
				"Esta oportunidad ya tiene una validación documental en proceso.",
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
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${params.opportunityId}))`,
		);
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
				hasProcessingRun: sql<boolean>`coalesce(bool_or(${documentIntegrityValidationRuns.status} = 'processing'), false)`,
			})
			.from(documentIntegrityValidationRuns)
			.where(
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
			);
		const resetAvailability = getResetAvailability({
			latestAttempt: attempts?.latest ?? 0,
			completedAttempts: attempts?.completed ?? 0,
			hasProcessingRun: attempts?.hasProcessingRun ?? false,
			maxAttempts: MAX_DOCUMENT_INTEGRITY_ATTEMPTS,
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
		.where(eq(documentIntegrityValidationRuns.id, runId))
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
		.select({ opportunityId: documentIntegrityValidationRuns.opportunityId })
		.from(documentIntegrityValidations)
		.innerJoin(
			documentIntegrityValidationRuns,
			eq(
				documentIntegrityValidations.validationRunId,
				documentIntegrityValidationRuns.id,
			),
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
	const pipelineError = params.storageError ?? params.aiError ?? null;

	const identifier = normalizeStatementIdentifier(llm?.identificador_detectado);
	const duplicates = await duplicateContext({
		sha256,
		identifier,
		opportunityId: params.opportunityId,
		leadId: params.leadId,
	});
	const engineResult = await runDocumentIntegrityEngine({
		buffer: params.buffer ?? Buffer.from("%PDF-1.4\nxref\n%%EOF"),
		llm,
		registeredNames: params.registeredNames,
		duplicates,
		pipelineError,
	});
	const [saved] = await db
		.insert(documentIntegrityValidations)
		.values({
			validationRunId: params.validationRunId,
			opportunityDocumentId: params.opportunityDocumentId,
			documentType: params.documentType,
			documentFilePath: params.filePath,
			contentSha256: sha256,
			autoResult: engineResult.result,
			autoScore: engineResult.score,
			autoReason: engineResult.reason,
			signals: engineResult.signals,
			technicalFingerprint: engineResult.technicalFingerprint,
			aiRawResponse: llm as Record<string, unknown> | null,
			retryCount: pipelineError ? retryCount || 1 : 0,
			errorMessage: pipelineError,
		})
		.returning();
	return saved;
}

interface PreparedValidationResult {
	validation: Awaited<ReturnType<typeof persistValidation>> | null;
	error?: string;
	errorCode?: DocumentIntegrityError["code"];
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
		fallbackConcurrency: 2,
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
					maxSizeBytes: MAX_FILE_SIZE_BYTES,
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
				return {
					documentType,
					filePath: file.key,
					fileName: file.name,
					buffer: null,
					storageError: errorMessage(error),
				} satisfies PreparedValidationDocument;
			}
		}),
	);
	const results = await executeValidationRun({
		documents: prepared,
		opportunityId: params.opportunityId,
		registeredNames: context.registeredNames,
		leadId: context.leadId,
		validationSource: "analisis_capacidad",
		requestedBy: params.userId,
	});
	return results.map((result, index) => {
		if (result.validation)
			return { file: params.files[index].name, validation: result.validation };
		return {
			file: params.files[index].name,
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

export async function assertUploadedBankStatementsValidated(params: {
	opportunityId: string;
	validationIds: string[];
	files: Array<{ filePath: string; contentSha256: string }>;
}) {
	const resetAfterAttemptNumber = await getLatestResetAttemptNumber(
		params.opportunityId,
	);
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

	const validations = await db
		.select({
			id: documentIntegrityValidations.id,
			validationRunId: documentIntegrityValidations.validationRunId,
			attemptNumber: documentIntegrityValidationRuns.attemptNumber,
			filePath: documentIntegrityValidations.documentFilePath,
			contentSha256: documentIntegrityValidations.contentSha256,
			autoResult: documentIntegrityValidations.autoResult,
		})
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
	if (
		!uploadedValidationPairsMatch({
			validationIds: params.validationIds,
			files: params.files,
			validations: validations.filter(
				(validation) => validation.attemptNumber > resetAfterAttemptNumber,
			),
		})
	) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"Los archivos del análisis no coinciden con la validación documental realizada.",
		);
	}
}

export async function linkUploadedValidationToDocument(params: {
	opportunityId: string;
	documentId: string;
	documentFilePath: string;
	buffer: Buffer;
}) {
	const sha256 = scanPdfBytes(params.buffer).sha256;
	const [candidate] = await db
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
				eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
				eq(documentIntegrityValidations.contentSha256, sha256),
				isNull(documentIntegrityValidations.opportunityDocumentId),
			),
		)
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(1);
	if (!candidate) return;
	await db
		.update(documentIntegrityValidations)
		.set({
			opportunityDocumentId: params.documentId,
			documentFilePath: params.documentFilePath,
		})
		.where(eq(documentIntegrityValidations.id, candidate.id));
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
		.selectDistinctOn([documentIntegrityValidations.opportunityDocumentId], {
			opportunityDocumentId: documentIntegrityValidations.opportunityDocumentId,
			documentType: documentIntegrityValidations.documentType,
			autoResult: documentIntegrityValidations.autoResult,
			validatedAt: sql<Date>`coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt})`,
			documentFilePath: documentIntegrityValidations.documentFilePath,
			signalCount: sql<number>`(
				select count(*)::int
				from jsonb_array_elements(${documentIntegrityValidations.signals}) as signal
				where signal->>'code' <> 'identidad_comparada'
			)`,
		})
		.from(documentIntegrityValidations)
		.innerJoin(
			documentIntegrityValidationRuns,
			eq(
				documentIntegrityValidations.validationRunId,
				documentIntegrityValidationRuns.id,
			),
		)
		.where(
			inArray(
				documentIntegrityValidations.opportunityDocumentId,
				bankDocuments.map((document) => document.id),
			),
		)
		.orderBy(
			documentIntegrityValidations.opportunityDocumentId,
			desc(documentIntegrityValidationRuns.attemptNumber),
		);
	const currentPaths = new Map(
		bankDocuments.map((document) => [document.id, document.filePath]),
	);
	return rows.map((row) => ({
		opportunityDocumentId: row.opportunityDocumentId,
		documentType: row.documentType,
		result: row.autoResult,
		validatedAt: row.validatedAt,
		isStale:
			currentPaths.get(row.opportunityDocumentId ?? "") !==
			row.documentFilePath,
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
		staleAfterMs: RUN_STALE_AFTER_MS,
	});
}

function originalNameFromStorageKey(filePath: string) {
	const storedName = filePath.split("/").at(-1) ?? "estado-de-cuenta.pdf";
	return storedName.replace(/^\d{13}-[a-z0-9]{6}-/i, "");
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
			opportunityDocumentId: documentIntegrityValidations.opportunityDocumentId,
			documentType: documentIntegrityValidations.documentType,
			filePath: documentIntegrityValidations.documentFilePath,
			result: documentIntegrityValidations.autoResult,
			reason: documentIntegrityValidations.autoReason,
		})
		.from(documentIntegrityValidations)
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
				validation.opportunityDocumentId !== null ||
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
			name: originalNameFromStorageKey(validation.filePath),
			key: validation.filePath,
			mimeType: "application/pdf",
		})),
		results: validations.map((validation) => ({
			file: originalNameFromStorageKey(validation.filePath),
			validation: {
				id: validation.id,
				result: validation.result,
				reason: validation.reason,
				validatedAt: run.completedAt ?? run.startedAt,
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
	const conditions = [];
	const cycleStartAfterAttemptNumber = sql<number>`coalesce((
		select max(quota_reset.reset_after_attempt_number)
		from document_integrity_validation_resets quota_reset
		where quota_reset.opportunity_id = ${documentIntegrityValidationRuns.opportunityId}
			and quota_reset.reset_after_attempt_number < ${documentIntegrityValidationRuns.attemptNumber}
	), 0)::int`;
	const isLatestDocumentValidation = sql<boolean>`
		${documentIntegrityValidationRuns.attemptNumber} = (
			select max(r2.attempt_number)
			from document_integrity_validations v2
			inner join document_integrity_validation_runs r2
				on r2.id = v2.validation_run_id
			where r2.opportunity_id = ${documentIntegrityValidationRuns.opportunityId}
				and coalesce(v2.opportunity_document_id::text, v2.content_sha256) =
					coalesce(${documentIntegrityValidations.opportunityDocumentId}::text, ${documentIntegrityValidations.contentSha256})
				and coalesce((
					select max(quota_reset_2.reset_after_attempt_number)
					from document_integrity_validation_resets quota_reset_2
					where quota_reset_2.opportunity_id = r2.opportunity_id
						and quota_reset_2.reset_after_attempt_number < r2.attempt_number
				), 0) = ${cycleStartAfterAttemptNumber}
		)`;
	if (params.opportunityId)
		conditions.push(
			eq(documentIntegrityValidationRuns.opportunityId, params.opportunityId),
		);
	const havingConditions = [];
	if (params.requiresReviewOnly)
		havingConditions.push(
			sql<boolean>`bool_or(${isLatestDocumentValidation} and ${documentIntegrityValidations.autoResult} in ('revision_manual', 'rechazado', 'error'))`,
		);
	if (params.search) {
		const pattern = `%${params.search}%`;
		havingConditions.push(
			sql<boolean>`bool_or(
				${opportunities.title} ilike ${pattern}
				or ${leads.firstName} ilike ${pattern}
				or ${leads.lastName} ilike ${pattern}
				or ${opportunityDocuments.originalName} ilike ${pattern}
				or ${documentIntegrityValidations.documentFilePath} ilike ${pattern}
			)`,
		);
	}
	return db
		.select({
			opportunityId: documentIntegrityValidationRuns.opportunityId,
			cycleStartAfterAttemptNumber,
			opportunityTitle: opportunities.title,
			leadFirstName: leads.firstName,
			leadLastName: leads.lastName,
			latestValidatedAt: sql<Date>`max(coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt}))`,
			documentCount: sql<number>`count(distinct coalesce(${documentIntegrityValidations.opportunityDocumentId}::text, ${documentIntegrityValidations.contentSha256}))::int`,
			validationCount: sql<number>`count(*)::int`,
			attemptCount: sql<number>`count(distinct ${documentIntegrityValidationRuns.id}) filter (where ${documentIntegrityValidationRuns.status} = 'completed')::int`,
			aggregateResult: sql<
				"valido" | "observacion" | "revision_manual" | "rechazado" | "error"
			>`case
				when bool_or(${isLatestDocumentValidation} and ${documentIntegrityValidations.autoResult} = 'rechazado') then 'rechazado'
				when bool_or(${isLatestDocumentValidation} and ${documentIntegrityValidations.autoResult} = 'error') then 'error'
				when bool_or(${isLatestDocumentValidation} and ${documentIntegrityValidations.autoResult} = 'revision_manual') then 'revision_manual'
				when bool_or(${isLatestDocumentValidation} and ${documentIntegrityValidations.autoResult} = 'observacion') then 'observacion'
				else 'valido'
			end`,
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
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.leftJoin(
			opportunityDocuments,
			eq(
				documentIntegrityValidations.opportunityDocumentId,
				opportunityDocuments.id,
			),
		)
		.where(conditions.length ? and(...conditions) : undefined)
		.groupBy(
			documentIntegrityValidationRuns.opportunityId,
			cycleStartAfterAttemptNumber,
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
	cycleStartAfterAttemptNumber?: number;
}) {
	let opportunityId = params.opportunityId;
	let validationAttemptNumber: number | undefined;
	if (!opportunityId && params.validationId) {
		const [validation] = await db
			.select({
				opportunityId: documentIntegrityValidationRuns.opportunityId,
				attemptNumber: documentIntegrityValidationRuns.attemptNumber,
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
		validationAttemptNumber = validation.attemptNumber;
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
		.where(eq(opportunities.id, opportunityId))
		.limit(1);
	if (!opportunity)
		throw new DocumentIntegrityError("NOT_FOUND", "Oportunidad no encontrada");
	const currentAttemptStatus = await getDocumentIntegrityAttemptStatus({
		opportunityId,
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
	const latestCycleStart = resets.at(-1)?.resetAfterAttemptNumber ?? 0;
	const cycleStartAfterAttemptNumber =
		params.cycleStartAfterAttemptNumber ??
		(validationAttemptNumber === undefined
			? latestCycleStart
			: (resets
					.filter(
						(reset) => reset.resetAfterAttemptNumber < validationAttemptNumber,
					)
					.at(-1)?.resetAfterAttemptNumber ?? 0));
	if (
		cycleStartAfterAttemptNumber !== 0 &&
		!resets.some(
			(reset) => reset.resetAfterAttemptNumber === cycleStartAfterAttemptNumber,
		)
	) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"El ciclo de validación solicitado no existe",
		);
	}
	const nextCycleStart = resets.find(
		(reset) => reset.resetAfterAttemptNumber > cycleStartAfterAttemptNumber,
	)?.resetAfterAttemptNumber;
	const cycleConditions = [
		eq(documentIntegrityValidationRuns.opportunityId, opportunityId),
		gt(
			documentIntegrityValidationRuns.attemptNumber,
			cycleStartAfterAttemptNumber,
		),
	];
	if (nextCycleStart !== undefined) {
		cycleConditions.push(
			lte(documentIntegrityValidationRuns.attemptNumber, nextCycleStart),
		);
	}

	const completedHistoryRuns = await db
		.select({ id: documentIntegrityValidationRuns.id })
		.from(documentIntegrityValidationRuns)
		.where(
			and(
				...cycleConditions,
				eq(documentIntegrityValidationRuns.status, "completed"),
			),
		)
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(MAX_DOCUMENT_INTEGRITY_ATTEMPTS);
	const recentErrorHistoryRuns = await db
		.select({ id: documentIntegrityValidationRuns.id })
		.from(documentIntegrityValidationRuns)
		.where(
			and(
				...cycleConditions,
				eq(documentIntegrityValidationRuns.status, "error"),
			),
		)
		.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		.limit(MAX_ERROR_RUNS_IN_HISTORY);
	const historyRunIds = [
		...completedHistoryRuns,
		...recentErrorHistoryRuns,
	].map((run) => run.id);

	const rows = historyRunIds.length
		? await db
				.select({
					id: documentIntegrityValidations.id,
					validationRunId: documentIntegrityValidations.validationRunId,
					opportunityDocumentId:
						documentIntegrityValidations.opportunityDocumentId,
					documentType: documentIntegrityValidations.documentType,
					documentFilePath: documentIntegrityValidations.documentFilePath,
					contentSha256: documentIntegrityValidations.contentSha256,
					autoResult: documentIntegrityValidations.autoResult,
					autoScore: documentIntegrityValidations.autoScore,
					autoReason: documentIntegrityValidations.autoReason,
					signals: documentIntegrityValidations.signals,
					aiRawResponse: documentIntegrityValidations.aiRawResponse,
					validationSource: documentIntegrityValidationRuns.validationSource,
					attemptNumber: documentIntegrityValidationRuns.attemptNumber,
					validatedAt: sql<Date>`coalesce(${documentIntegrityValidationRuns.completedAt}, ${documentIntegrityValidationRuns.startedAt})`,
					documentName: opportunityDocuments.originalName,
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
					opportunityDocuments,
					eq(
						documentIntegrityValidations.opportunityDocumentId,
						opportunityDocuments.id,
					),
				)
				.where(
					inArray(documentIntegrityValidations.validationRunId, historyRunIds),
				)
				.orderBy(desc(documentIntegrityValidationRuns.attemptNumber))
		: [];

	const validationDetails = await Promise.all(
		rows.map(async (row) => {
			const { documentFilePath, aiRawResponse, ...details } = row;
			const positiveChecks = buildDocumentPositiveChecks({
				aiRawResponse,
				signals: row.signals,
			});
			return {
				...details,
				signals: details.signals.filter(
					(signal) => signal.code !== "identidad_comparada",
				),
				positiveChecks,
				signedUrl: await getFileUrl(documentFilePath),
			};
		}),
	);
	const attemptsByRun = new Map<
		string,
		{
			validationRunId: string;
			attemptNumber: number;
			validationSource: (typeof validationDetails)[number]["validationSource"];
			validatedAt: Date;
			validations: typeof validationDetails;
		}
	>();
	for (const validation of validationDetails) {
		const attempt = attemptsByRun.get(validation.validationRunId) ?? {
			validationRunId: validation.validationRunId,
			attemptNumber: validation.attemptNumber,
			validationSource: validation.validationSource,
			validatedAt: validation.validatedAt,
			validations: [],
		};
		attempt.validations.push(validation);
		attemptsByRun.set(validation.validationRunId, attempt);
	}
	const attempts = [...attemptsByRun.values()].sort(
		(left, right) => right.attemptNumber - left.attemptNumber,
	);
	const completedHistoryRunIds = new Set(
		completedHistoryRuns.map((run) => run.id),
	);
	const validations =
		attempts.find((attempt) =>
			completedHistoryRunIds.has(attempt.validationRunId),
		)?.validations ?? [];
	const cycleReset = resets.find(
		(reset) => reset.resetAfterAttemptNumber === cycleStartAfterAttemptNumber,
	);
	const attemptCount = completedHistoryRuns.length;
	const isCurrentCycle = cycleStartAfterAttemptNumber === latestCycleStart;
	const attemptStatus = {
		attemptCount,
		maxAttempts: MAX_DOCUMENT_INTEGRITY_ATTEMPTS,
		remainingAttempts: Math.max(
			0,
			MAX_DOCUMENT_INTEGRITY_ATTEMPTS - attemptCount,
		),
		canValidate: isCurrentCycle && currentAttemptStatus.canValidate,
		hasProcessingRun: isCurrentCycle && currentAttemptStatus.hasProcessingRun,
	};

	return {
		...opportunity,
		...attemptStatus,
		cycleNumber:
			[0, ...resets.map((reset) => reset.resetAfterAttemptNumber)].indexOf(
				cycleStartAfterAttemptNumber,
			) + 1,
		cycleStartAfterAttemptNumber,
		reset: cycleReset
			? {
					resetAt: cycleReset.resetAt,
					resetByName: cycleReset.resetByName,
					resetByEmail: cycleReset.resetByEmail,
				}
			: null,
		validations,
		attempts,
	};
}
