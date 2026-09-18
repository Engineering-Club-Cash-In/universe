import { createHash, randomUUID } from "node:crypto";
import { google } from "@ai-sdk/google";
import { ORPCError } from "@orpc/server";
import { generateObject } from "ai";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	coDebtors,
	creditAnalysis,
	leads,
	opportunities,
} from "../db/schema/crm";
import { opportunityDocuments } from "../db/schema/documents";
import {
	BANK_ANALYSIS_PROMPT,
	type BankStatementAnalysis,
	bankStatementAnalysisSchema,
} from "../lib/bank-analysis-schema";
import {
	canAutoAttachBankStatementDocuments,
	resolveBankStatementMonthlyCoverage,
} from "../lib/bank-statement-documents";
import {
	rebuildClientDocumentChecklistInTransaction,
	refreshChecklistForClientDocuments,
} from "../lib/checklist";
import {
	assertOpportunityBelongsToLead,
	canWriteOpportunityCreditAnalysis,
	getCreditAnalysisOwnerCondition,
	getCreditAnalysisResourceId,
} from "../lib/credit-analysis-ownership";
import { calculateCreditCapacity } from "../lib/financial-math";
import { crmProcedure } from "../lib/orpc";
import {
	buildUploadPrefix,
	deleteFileFromR2,
	generateUniqueFilename,
	getFileBuffer,
	uploadFileToR2,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import {
	assertBankStatementCoverageReservationCurrent,
	type CreditAnalysisResetReservation,
	DocumentIntegrityError,
	linkUploadedValidationsToDocuments,
	releaseCapacityAnalysisReservation,
	reserveBankStatementCoverageMutation,
	reserveCapacityAnalysis,
	reserveCreditAnalysisReset,
} from "../services/document-integrity";
import {
	applyManualCoverageDeclaration,
	assertBankStatementCoverageMutation,
	type BankStatementCoverageCleanupDebt,
	BankStatementCoverageSaveError,
	buildBankStatementArtifactPlan,
	getBankStatementArtifactTag,
	getInitialBankStatementCoverageSaveStatus,
	type PersistedBankStatementCoverage,
	runBankStatementArtifactPersistenceCore,
	runBankStatementCleanupDebtCore,
	runBankStatementCoverageMutationHandlerCore,
	runBankStatementCoverageSaveLifecycle,
	runInitialBankStatementHandlerCore,
	runOpportunityCreditAnalysisResetCore,
	runReservedBankStatementCoverageMutationCore,
	toPublicBankStatementCoverage,
} from "./bank-analysis-coverage";

const MAX_AI_ATTEMPTS = 2;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB por archivo
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const AI_TIMEOUT_MS = 120_000; // 2 minutos timeout para la IA

// Mismo nombre de variable que usa cartera-back para no tener dos tasas distintas.
const RAW_USD_EXCHANGE_RATE = Number(process.env.USD_EXCHANGE_RATE);
const USD_EXCHANGE_RATE =
	Number.isFinite(RAW_USD_EXCHANGE_RATE) && RAW_USD_EXCHANGE_RATE > 0
		? RAW_USD_EXCHANGE_RATE
		: 7.78;

const toQuetzales = (amount: number) =>
	Math.round(amount * USD_EXCHANGE_RATE * 100) / 100;

/**
 * La IA reporta los montos en la moneda original del estado de cuenta (no convierte,
 * porque no conoce el tipo de cambio). Todo lo que sigue en el sistema asume quetzales,
 * así que los análisis en dólares se convierten aquí antes de calcular capacidad y persistir.
 */
function convertAnalysisToQuetzales(
	analysis: BankStatementAnalysis,
): BankStatementAnalysis {
	const { promedio_mensual } = analysis;

	return {
		...analysis,
		resumen_mensual: analysis.resumen_mensual.map((mes) => ({
			...mes,
			saldo_inicial: toQuetzales(mes.saldo_inicial),
			total_debitos: toQuetzales(mes.total_debitos),
			total_creditos: toQuetzales(mes.total_creditos),
			saldo_final: toQuetzales(mes.saldo_final),
			ingresos: {
				fijos: toQuetzales(mes.ingresos.fijos),
				variables: toQuetzales(mes.ingresos.variables),
			},
			gastos: {
				fijos: toQuetzales(mes.gastos.fijos),
				variables: toQuetzales(mes.gastos.variables),
			},
		})),
		promedio_mensual: {
			promedio_ingresos_fijos: toQuetzales(
				promedio_mensual.promedio_ingresos_fijos,
			),
			promedio_ingresos_variables: toQuetzales(
				promedio_mensual.promedio_ingresos_variables,
			),
			promedio_gastos_fijos: toQuetzales(
				promedio_mensual.promedio_gastos_fijos,
			),
			promedio_gastos_variables: toQuetzales(
				promedio_mensual.promedio_gastos_variables,
			),
			disponibilidad_economica: toQuetzales(
				promedio_mensual.disponibilidad_economica,
			),
		},
		moneda: "GTQ",
	};
}

const persistedCoverageSchema = z.object({
	version: z.literal(1),
	analysisBatchId: z.string().uuid(),
	status: z.enum(["detected", "needs_confirmation"]),
	saveStatus: z.enum(["pending", "saved", "failed", "not_applicable"]),
	saveError: z.string().optional(),
	months: z.array(
		z.object({
			month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
			sourceFileIndexes: z.array(z.number().int().min(0).max(8)),
		}),
	),
	files: z
		.array(
			z.object({
				fileIndex: z.number().int().min(0).max(8),
				name: z.string().min(1),
				evidenceKey: z.string().min(1),
				contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
				integrityValidationId: z.string().uuid(),
				mimeType: z.string().optional(),
				size: z.number().int().nonnegative().optional(),
				status: z.enum(["detected", "confirmed", "needs_confirmation"]),
				detectedMonths: z.array(z.string()),
				effectiveMonths: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
			}),
		)
		.min(1)
		.max(9),
	checklistAssignments: z.array(
		z.object({
			month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
			fileIndex: z.number().int().min(0).max(8),
			sourceFileIndexes: z.array(z.number().int().min(0).max(8)),
			documentType: z
				.enum(["estados_cuenta_1", "estados_cuenta_2", "estados_cuenta_3"])
				.optional(),
		}),
	),
	requestedChecklistAssignments: z
		.array(
			z.object({
				month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
				fileIndex: z.number().int().min(0).max(8),
				sourceFileIndexes: z.array(z.number().int().min(0).max(8)),
			}),
		)
		.optional(),
	pendingChecklistAssignments: z
		.array(
			z.object({
				month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
				fileIndex: z.number().int().min(0).max(8),
				sourceFileIndexes: z.array(z.number().int().min(0).max(8)),
			}),
		)
		.optional(),
	cleanupDebt: z
		.array(
			z.object({
				status: z.literal("pending"),
				key: z.string().min(1),
				artifactId: z.string().uuid().optional(),
			}),
		)
		.optional(),
	manualDeclarations: z.array(
		z.object({
			fileIndex: z.number().int().min(0).max(8),
			months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
			detectedMonths: z.array(z.string()),
			actorId: z.string(),
			declaredAt: z.string().datetime(),
		}),
	),
	reportedCoverage: z.array(
		z.object({
			indice_archivo: z.number().int(),
			meses: z.array(z.string()),
		}),
	),
	issues: z.array(z.string()),
	savedDocuments: z
		.array(
			z.object({
				id: z.string().uuid(),
				tag: z.string(),
				fileIndex: z.number().int().min(0).max(8),
				documentType: z.enum([
					"estados_cuenta_1",
					"estados_cuenta_2",
					"estados_cuenta_3",
					"other",
				]),
				month: z.string().optional(),
			}),
		)
		.optional(),
});

function parsePersistedBankAnalysis(fullAnalysis: string | null) {
	if (!fullAnalysis) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "El análisis no tiene cobertura mensual registrada.",
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(fullAnalysis);
	} catch {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "El análisis guardado no se puede recuperar.",
		});
	}
	if (!parsed || typeof parsed !== "object") {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "El análisis guardado no se puede recuperar.",
		});
	}
	const record = parsed as Record<string, unknown>;
	const coverage = persistedCoverageSchema.safeParse(record.cobertura_mensual);
	if (!coverage.success) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "El análisis no tiene cobertura mensual vigente.",
		});
	}
	return { fullAnalysis: record, coverage: coverage.data };
}

async function saveBankCoverageDocuments(params: {
	opportunityId: string;
	vehicleId: string | null;
	userId: string;
	reservationToken: string;
	coverage: PersistedBankStatementCoverage;
	buffers: Map<number, Buffer>;
}) {
	const renewReservation = async () => {
		const [renewed] = await db
			.update(creditAnalysis)
			.set({ analysisReservationStartedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(creditAnalysis.opportunityId, params.opportunityId),
					eq(creditAnalysis.analysisReservationToken, params.reservationToken),
				),
			)
			.returning({ id: creditAnalysis.id });
		if (!renewed) throw new Error("La reserva de guardado ya no está vigente.");
	};
	const quarantineArtifactAndRefresh = async (
		artifactId: string,
		cleanupTag: string,
	) => {
		await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(opportunityDocuments)
				.set({ documentType: "other", description: cleanupTag })
				.where(
					and(
						eq(opportunityDocuments.id, artifactId),
						eq(opportunityDocuments.opportunityId, params.opportunityId),
					),
				)
				.returning({ id: opportunityDocuments.id });
			if (!updated) throw new Error("El adjunto ya no existe para aislarlo.");
			await rebuildClientDocumentChecklistInTransaction(
				tx,
				params.opportunityId,
				!!params.vehicleId,
			);
		});
	};
	await renewReservation();
	return runBankStatementArtifactPersistenceCore({
		coverage: params.coverage,
		loadExistingDocuments: () =>
			db
				.select({
					id: opportunityDocuments.id,
					documentType: opportunityDocuments.documentType,
					description: opportunityDocuments.description,
					filePath: opportunityDocuments.filePath,
				})
				.from(opportunityDocuments)
				.where(eq(opportunityDocuments.opportunityId, params.opportunityId)),
		readStoredFile: getFileBuffer,
		createArtifact: async (artifact) => {
			const buffer = params.buffers.get(artifact.fileIndex);
			if (!buffer) throw new Error("No se encontró la evidencia del archivo.");
			const uniqueFilename = generateUniqueFilename(artifact.file.name);
			const { key } = await uploadFileToR2(
				new Blob([new Uint8Array(buffer)], {
					type: artifact.file.mimeType ?? "application/pdf",
				}),
				uniqueFilename,
				params.opportunityId,
			);
			try {
				const [document] = await db
					.insert(opportunityDocuments)
					.values({
						opportunityId: params.opportunityId,
						filename: uniqueFilename,
						originalName: artifact.file.name,
						mimeType: artifact.file.mimeType ?? "application/pdf",
						size: artifact.file.size ?? buffer.length,
						documentType: "other",
						description: `[bank-coverage-debt:${artifact.analysisBatchId}:staging:file:${artifact.fileIndex}]`,
						uploadedBy: params.userId,
						filePath: key,
					})
					.returning({ id: opportunityDocuments.id });
				if (!document) throw new Error("No se pudo registrar el documento.");
				return { ...artifact, id: document.id, filePath: key };
			} catch (error) {
				try {
					await deleteFileFromR2(key);
				} catch {
					throw new BankStatementCoverageSaveError(error, [
						{ status: "pending", key },
					]);
				}
				throw error;
			}
		},
		reuseArtifact: async (existing, artifact) => ({
			...artifact,
			id: existing.id,
			filePath: existing.filePath,
		}),
		rollbackReusedArtifact: async (artifact) => {
			await db
				.update(opportunityDocuments)
				.set({
					documentType: artifact.documentType,
					description: artifact.description,
				})
				.where(
					and(
						eq(opportunityDocuments.id, artifact.id),
						eq(opportunityDocuments.opportunityId, params.opportunityId),
					),
				);
		},
		linkArtifacts: async (artifacts) => {
			await renewReservation();
			if (
				artifacts.some(
					(artifact) =>
						!artifact.file.evidenceKey.includes("/validated/") ||
						!artifact.file.integrityValidationId,
				)
			) {
				throw new Error("La evidencia de integridad ya no está vigente.");
			}
			await linkUploadedValidationsToDocuments({
				opportunityId: params.opportunityId,
				reservationToken: params.reservationToken,
				links: artifacts.map((artifact) => ({
					documentId: artifact.id,
					documentFilePath: artifact.filePath,
					sourceFilePath: artifact.file.evidenceKey,
					buffer: params.buffers.get(artifact.fileIndex)!,
					validationId: artifact.file.integrityValidationId!,
				})),
			});
		},
		commitArtifacts: (artifacts) =>
			db.transaction(async (tx) => {
				const [analysis] = await tx
					.select({ token: creditAnalysis.analysisReservationToken })
					.from(creditAnalysis)
					.where(eq(creditAnalysis.opportunityId, params.opportunityId))
					.limit(1);
				if (analysis?.token !== params.reservationToken) {
					throw new Error("La reserva de guardado ya no está vigente.");
				}
				for (const artifact of artifacts) {
					const [updated] = await tx
						.update(opportunityDocuments)
						.set({
							documentType: artifact.documentType,
							description: artifact.description,
						})
						.where(
							and(
								eq(opportunityDocuments.id, artifact.id),
								eq(opportunityDocuments.opportunityId, params.opportunityId),
							),
						)
						.returning({ id: opportunityDocuments.id });
					if (!updated) {
						throw new Error("El adjunto ya no existe para promoverlo.");
					}
				}
				await rebuildClientDocumentChecklistInTransaction(
					tx,
					params.opportunityId,
					!!params.vehicleId,
				);
				return artifacts;
			}),
		promoteArtifact: async (artifact) => {
			const [updated] = await db
				.update(opportunityDocuments)
				.set({
					documentType: artifact.documentType,
					description: artifact.description,
				})
				.where(
					and(
						eq(opportunityDocuments.id, artifact.id),
						eq(opportunityDocuments.opportunityId, params.opportunityId),
					),
				)
				.returning({ id: opportunityDocuments.id });
			if (!updated) throw new Error("El adjunto ya no existe para promoverlo.");
			return artifact;
		},
		refreshChecklist: async () => {
			await refreshChecklistForClientDocuments(
				params.opportunityId,
				"estados_cuenta_1",
				params.coverage.analysisBatchId,
				!!params.vehicleId,
				params.vehicleId ?? undefined,
			);
		},
		rollbackArtifact: async (artifact) => {
			await deleteFileFromR2(artifact.filePath);
			await db
				.delete(opportunityDocuments)
				.where(
					and(
						eq(opportunityDocuments.id, artifact.id),
						eq(opportunityDocuments.opportunityId, params.opportunityId),
					),
				);
		},
		quarantineArtifact: (artifact, cleanupTag) =>
			quarantineArtifactAndRefresh(artifact.id, cleanupTag),
		retireArtifact: async (artifact) => {
			const cleanupTag = `[bank-coverage-debt:${artifact.analysisBatchId}:artifact:${artifact.id}:file:${artifact.fileIndex}]`;
			try {
				await quarantineArtifactAndRefresh(artifact.id, cleanupTag);
			} catch (error) {
				throw new BankStatementCoverageSaveError(error, []);
			}
			await deleteFileFromR2(artifact.filePath);
			await db
				.delete(opportunityDocuments)
				.where(
					and(
						eq(opportunityDocuments.id, artifact.id),
						eq(opportunityDocuments.opportunityId, params.opportunityId),
					),
				);
		},
	});
}

async function cleanupBankStatementCoverageDebt({
	opportunityId,
	vehicleId,
	analysisBatchId,
	debt,
}: {
	opportunityId: string;
	vehicleId: string | null;
	analysisBatchId: string;
	debt: BankStatementCoverageCleanupDebt[];
}): Promise<BankStatementCoverageCleanupDebt[]> {
	return runBankStatementCleanupDebtCore({
		opportunityId,
		analysisBatchId,
		debt,
		readArtifact: async (artifactId) => {
			const [document] = await db
				.select({
					id: opportunityDocuments.id,
					description: opportunityDocuments.description,
					filePath: opportunityDocuments.filePath,
				})
				.from(opportunityDocuments)
				.where(
					and(
						eq(opportunityDocuments.id, artifactId),
						eq(opportunityDocuments.opportunityId, opportunityId),
					),
				)
				.limit(1);
			return document ?? null;
		},
		deleteStoredFile: deleteFileFromR2,
		deleteArtifact: async (artifactId) => {
			await db
				.delete(opportunityDocuments)
				.where(
					and(
						eq(opportunityDocuments.id, artifactId),
						eq(opportunityDocuments.opportunityId, opportunityId),
					),
				);
		},
		refreshChecklist: () =>
			refreshChecklistForClientDocuments(
				opportunityId,
				"estados_cuenta_1",
				analysisBatchId,
				!!vehicleId,
				vehicleId ?? undefined,
			),
	});
}

async function assertBankStatementResetReservation(
	tx: Transaction,
	params: {
		opportunityId: string;
		leadId: string;
		reservation: CreditAnalysisResetReservation;
	},
) {
	const [analysis] = await tx
		.update(creditAnalysis)
		.set({
			analysisReservationStartedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(creditAnalysis.id, params.reservation.analysisId),
				eq(creditAnalysis.opportunityId, params.opportunityId),
				eq(creditAnalysis.leadId, params.leadId),
				eq(creditAnalysis.analysisReservationToken, params.reservation.token),
			),
		)
		.returning({ id: creditAnalysis.id });
	if (!analysis) {
		throw new DocumentIntegrityError(
			"BAD_REQUEST",
			"La reserva del restablecimiento ya no está vigente.",
		);
	}
}

export async function resetBankStatementCreditAnalysis(params: {
	opportunityId: string;
	leadId: string;
}) {
	let fullAnalysisRecord: Record<string, unknown> | null = null;
	let hasVehicle = false;
	return runOpportunityCreditAnalysisResetCore({
		opportunityId: params.opportunityId,
		reserveReset: () => reserveCreditAnalysisReset(params),
		releaseReset: ({ token }) =>
			releaseCapacityAnalysisReservation({
				opportunityId: params.opportunityId,
				token,
			}),
		assertResetCurrent: (reservation) =>
			db.transaction((tx) =>
				assertBankStatementResetReservation(tx, {
					...params,
					reservation,
				}),
			),
		loadAnalysis: async (reservation) => {
			const [analysis] = await db
				.select({
					id: creditAnalysis.id,
					fullAnalysis: creditAnalysis.fullAnalysis,
				})
				.from(creditAnalysis)
				.where(
					and(
						eq(creditAnalysis.id, reservation.analysisId),
						eq(creditAnalysis.opportunityId, params.opportunityId),
						eq(creditAnalysis.leadId, params.leadId),
						eq(creditAnalysis.analysisReservationToken, reservation.token),
					),
				)
				.limit(1);
			if (!analysis) return null;
			const [opportunity] = await db
				.select({ vehicleId: opportunities.vehicleId })
				.from(opportunities)
				.where(eq(opportunities.id, params.opportunityId))
				.limit(1);
			hasVehicle = !!opportunity?.vehicleId;
			if (!analysis.fullAnalysis) {
				fullAnalysisRecord = null;
				return { id: analysis.id, coverage: null };
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(analysis.fullAnalysis);
			} catch {
				throw new DocumentIntegrityError(
					"BAD_REQUEST",
					"El análisis guardado no se puede recuperar para restablecerlo.",
				);
			}
			if (!parsed || typeof parsed !== "object") {
				throw new DocumentIntegrityError(
					"BAD_REQUEST",
					"El análisis guardado no se puede recuperar para restablecerlo.",
				);
			}
			fullAnalysisRecord = parsed as Record<string, unknown>;
			if (!("cobertura_mensual" in fullAnalysisRecord)) {
				return { id: analysis.id, coverage: null };
			}
			const coverage = persistedCoverageSchema.safeParse(
				fullAnalysisRecord.cobertura_mensual,
			);
			if (!coverage.success) {
				throw new DocumentIntegrityError(
					"BAD_REQUEST",
					"La cobertura guardada no se puede recuperar para restablecerla.",
				);
			}
			return { id: analysis.id, coverage: coverage.data };
		},
		loadDocuments: () =>
			db
				.select({
					id: opportunityDocuments.id,
					documentType: opportunityDocuments.documentType,
					description: opportunityDocuments.description,
					filePath: opportunityDocuments.filePath,
				})
				.from(opportunityDocuments)
				.where(eq(opportunityDocuments.opportunityId, params.opportunityId)),
		persistRecovery: async (analysisId, coverage, reservation) => {
			if (!fullAnalysisRecord) {
				throw new Error(
					"No existe metadata privada para recuperar la limpieza.",
				);
			}
			fullAnalysisRecord.cobertura_mensual = coverage;
			const [updated] = await db
				.update(creditAnalysis)
				.set({
					fullAnalysis: JSON.stringify(fullAnalysisRecord),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(creditAnalysis.id, analysisId),
						eq(creditAnalysis.opportunityId, params.opportunityId),
						eq(creditAnalysis.leadId, params.leadId),
						eq(creditAnalysis.analysisReservationToken, reservation.token),
					),
				)
				.returning({ id: creditAnalysis.id });
			if (!updated)
				throw new Error("El análisis ya no existe para recuperar la limpieza.");
		},
		quarantineArtifactsAndRefresh: (artifacts, analysisBatchId, reservation) =>
			db.transaction(async (tx) => {
				await assertBankStatementResetReservation(tx, {
					...params,
					reservation,
				});
				for (const artifact of artifacts) {
					const [updated] = await tx
						.update(opportunityDocuments)
						.set({
							documentType: "other",
							description: `[bank-coverage-debt:${analysisBatchId}:reset:artifact:${artifact.id}]`,
						})
						.where(
							and(
								eq(opportunityDocuments.id, artifact.id),
								eq(opportunityDocuments.opportunityId, params.opportunityId),
							),
						)
						.returning({ id: opportunityDocuments.id });
					if (!updated)
						throw new Error("Un adjunto ya no existe para aislarlo.");
				}
				await rebuildClientDocumentChecklistInTransaction(
					tx,
					params.opportunityId,
					hasVehicle,
				);
			}),
		deleteStoredFile: deleteFileFromR2,
		deleteArtifactAndRefresh: (artifact, reservation) =>
			db.transaction(async (tx) => {
				await assertBankStatementResetReservation(tx, {
					...params,
					reservation,
				});
				await tx
					.delete(opportunityDocuments)
					.where(
						and(
							eq(opportunityDocuments.id, artifact.id),
							eq(opportunityDocuments.opportunityId, params.opportunityId),
						),
					);
				await rebuildClientDocumentChecklistInTransaction(
					tx,
					params.opportunityId,
					hasVehicle,
				);
			}),
		deleteAnalysis: async (analysisId, reservation) => {
			const [deleted] = await db
				.delete(creditAnalysis)
				.where(
					and(
						eq(creditAnalysis.id, analysisId),
						eq(creditAnalysis.opportunityId, params.opportunityId),
						eq(creditAnalysis.leadId, params.leadId),
						eq(creditAnalysis.analysisReservationToken, reservation.token),
					),
				)
				.returning({ id: creditAnalysis.id });
			if (!deleted)
				throw new Error("El análisis ya no existe para restablecerlo.");
		},
	});
}

async function mutatePersistedBankCoverage(params: {
	leadId: string;
	opportunityId: string;
	analysisId: string;
	analysisBatchId: string;
	userId: string;
	userRole: string;
	manualDeclaration?: { fileIndex: number; months: string[] };
}) {
	return runReservedBankStatementCoverageMutationCore({
		reserve: async () => {
			try {
				return await reserveBankStatementCoverageMutation({
					opportunityId: params.opportunityId,
					leadId: params.leadId,
					analysisId: params.analysisId,
				});
			} catch (error) {
				if (error instanceof DocumentIntegrityError) {
					throw new ORPCError("PRECONDITION_FAILED", {
						message: error.message,
					});
				}
				throw error;
			}
		},
		loadCurrentOpportunity: async () => {
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					leadId: opportunities.leadId,
					vehicleId: opportunities.vehicleId,
					assignedTo: opportunities.assignedTo,
				})
				.from(opportunities)
				.where(eq(opportunities.id, params.opportunityId))
				.limit(1);
			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}
			const canWrite = canAutoAttachBankStatementDocuments({
				userRole: params.userRole,
				userId: params.userId,
				opportunityAssignedTo: opportunity.assignedTo,
			});
			try {
				if (!canWrite) throw new Error("Sin permiso para modificar cobertura");
				assertOpportunityBelongsToLead(opportunity, params.leadId);
			} catch (error) {
				throw new ORPCError(canWrite ? "PRECONDITION_FAILED" : "FORBIDDEN", {
					message: error instanceof Error ? error.message : String(error),
				});
			}
			return { opportunity, canWrite };
		},
		loadCurrentCoverage: async (reservation, { canWrite }) => {
			const [analysisRow] = await db
				.select({
					id: creditAnalysis.id,
					leadId: creditAnalysis.leadId,
					opportunityId: creditAnalysis.opportunityId,
					fullAnalysis: creditAnalysis.fullAnalysis,
				})
				.from(creditAnalysis)
				.where(
					and(
						eq(creditAnalysis.id, params.analysisId),
						eq(creditAnalysis.opportunityId, params.opportunityId),
						eq(creditAnalysis.leadId, params.leadId),
						eq(creditAnalysis.analysisReservationToken, reservation.token),
					),
				)
				.limit(1);
			if (!analysisRow) {
				throw new ORPCError("PRECONDITION_FAILED", {
					message: "El análisis ya no corresponde a esta oportunidad.",
				});
			}
			const { fullAnalysis, coverage } = parsePersistedBankAnalysis(
				analysisRow.fullAnalysis,
			);
			try {
				assertBankStatementCoverageMutation({
					requestedOpportunityId: params.opportunityId,
					requestedAnalysisId: params.analysisId,
					requestedLeadId: params.leadId,
					currentOpportunityId: analysisRow.opportunityId,
					currentAnalysisId: analysisRow.id,
					currentLeadId: analysisRow.leadId,
					requestedAnalysisBatchId: params.analysisBatchId,
					currentAnalysisBatchId: coverage.analysisBatchId,
					canWrite,
					integrityBatchCurrent: true,
				});
				if (params.manualDeclaration) {
					const targetFile = coverage.files.find(
						(file) => file.fileIndex === params.manualDeclaration?.fileIndex,
					);
					if (!targetFile || targetFile.status !== "needs_confirmation") {
						throw new Error(
							"Este archivo ya no requiere confirmación mensual.",
						);
					}
				}
				await assertBankStatementCoverageReservationCurrent({
					opportunityId: params.opportunityId,
					leadId: params.leadId,
					analysisId: params.analysisId,
					token: reservation.token,
					validationIds: coverage.files.map(
						(file) => file.integrityValidationId,
					),
					files: coverage.files.map((file) => ({
						filePath: file.evidenceKey,
						contentSha256: file.contentSha256,
					})),
				});
			} catch (error) {
				if (error instanceof ORPCError) throw error;
				if (error instanceof DocumentIntegrityError) {
					throw new ORPCError("PRECONDITION_FAILED", {
						message: error.message,
					});
				}
				throw new ORPCError(canWrite ? "PRECONDITION_FAILED" : "FORBIDDEN", {
					message: error instanceof Error ? error.message : String(error),
				});
			}
			return { fullAnalysis, coverage };
		},
		mutateCurrentCoverage: async (
			{ fullAnalysis, coverage },
			reservation,
			{ opportunity },
		) => {
			const finalCoverage = await runBankStatementCoverageMutationHandlerCore({
				coverage,
				manualDeclaration: params.manualDeclaration,
				actorId: params.userId,
				declaredAt: new Date().toISOString(),
				validateCurrent: async () => {},
				persistCoverage: async (updatedCoverage) => {
					fullAnalysis.cobertura_mensual = updatedCoverage;
					const [updated] = await db
						.update(creditAnalysis)
						.set({
							fullAnalysis: JSON.stringify(fullAnalysis),
							updatedAt: new Date(),
						})
						.where(
							and(
								eq(creditAnalysis.id, params.analysisId),
								eq(creditAnalysis.analysisReservationToken, reservation.token),
							),
						)
						.returning({ id: creditAnalysis.id });
					if (!updated) {
						throw new ORPCError("PRECONDITION_FAILED", {
							message:
								"El lote de análisis cambió antes de guardar la cobertura.",
						});
					}
				},
				cleanupDebt: (debt) =>
					cleanupBankStatementCoverageDebt({
						opportunityId: params.opportunityId,
						vehicleId: opportunity.vehicleId,
						analysisBatchId: coverage.analysisBatchId,
						debt,
					}),
				saveArtifacts: async (coverageToSave) => {
					const buffers = new Map<number, Buffer>();
					for (const file of coverageToSave.files) {
						const expectedPrefix = `${buildUploadPrefix(
							"bank_statement",
							params.opportunityId,
						)}/validated/`;
						if (!file.evidenceKey.startsWith(expectedPrefix)) {
							throw new Error(
								"La evidencia del archivo no pertenece a la oportunidad.",
							);
						}
						const buffer = await getFileBuffer(file.evidenceKey);
						const hash = createHash("sha256").update(buffer).digest("hex");
						if (hash !== file.contentSha256) {
							throw new Error(
								"La evidencia del archivo cambió desde el análisis.",
							);
						}
						buffers.set(file.fileIndex, buffer);
					}
					return saveBankCoverageDocuments({
						opportunityId: params.opportunityId,
						vehicleId: opportunity.vehicleId,
						userId: params.userId,
						reservationToken: reservation.token,
						coverage: coverageToSave,
						buffers,
					});
				},
			});
			return { coverage: toPublicBankStatementCoverage(finalCoverage) };
		},
		release: async (reservation) => {
			try {
				await releaseCapacityAnalysisReservation(reservation);
			} catch (error) {
				console.error("Failed to release coverage save reservation", {
					opportunityId: params.opportunityId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	});
}

export const bankAnalysisRouter = {
	analyzeBankStatements: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
					files: z
						.array(
							z.object({
								name: z.string(),
								key: z.string(), // R2 key from presigned upload
								mimeType: z.string().default("application/pdf"),
							}),
						)
						.min(1)
						.max(9),
					integrityValidationIds: z
						.array(z.string().uuid())
						.min(1)
						.max(9)
						.optional(),
					annualRate: z.number().default(0.18),
					termMonths: z.number().int().min(12).max(120).default(60),
					maxDebtRatio: z.number().min(0).max(1).default(0.2),
					maxVariableDebtRatio: z.number().min(0).max(1).default(0.2),
					opportunityId: z.string().uuid().optional(),
				})
				.refine((data) => data.leadId || data.coDebtorId, {
					message: "Debe proporcionar leadId o coDebtorId",
				})
				.refine((data) => !data.leadId || !!data.opportunityId, {
					message: "Debe proporcionar opportunityId para analizar un lead",
				})
				.refine((data) => !(data.leadId && data.coDebtorId), {
					message: "No puede analizar un lead y un co-deudor a la vez",
				})
				.refine(
					(data) =>
						!data.leadId ||
						data.integrityValidationIds?.length === data.files.length,
					{
						message:
							"Valide la legitimidad de todos los documentos antes de analizar la capacidad de pago",
					},
				),
		)
		.handler(async ({ input, context }) => {
			const isForLead = !!input.leadId;
			const owner = isForLead
				? { leadId: input.leadId!, opportunityId: input.opportunityId! }
				: { coDebtorId: input.coDebtorId! };
			const resourceId = getCreditAnalysisResourceId(owner);
			const expectedPrefix = buildUploadPrefix("bank_statement", resourceId);

			// 1. Verificar que el lead/co-deudor existe
			if (isForLead) {
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, input.leadId!))
					.limit(1);

				if (lead.length === 0) {
					throw new ORPCError("NOT_FOUND", {
						message: "Lead no encontrado",
					});
				}
			} else {
				const coDebtor = await db
					.select()
					.from(coDebtors)
					.where(eq(coDebtors.id, input.coDebtorId!))
					.limit(1);

				if (coDebtor.length === 0) {
					throw new ORPCError("NOT_FOUND", {
						message: "Co-deudor no encontrado",
					});
				}
			}

			let opportunityForDocuments:
				| { id: string; vehicleId: string | null }
				| undefined;

			if (isForLead) {
				const [opportunity] = await db
					.select({
						id: opportunities.id,
						leadId: opportunities.leadId,
						vehicleId: opportunities.vehicleId,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId!))
					.limit(1);

				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}

				try {
					assertOpportunityBelongsToLead(opportunity, input.leadId!);
				} catch (error) {
					throw new ORPCError("BAD_REQUEST", {
						message: error instanceof Error ? error.message : String(error),
					});
				}
				if (
					!canWriteOpportunityCreditAnalysis(
						context.userRole,
						context.userId,
						opportunity.assignedTo,
					)
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para analizar esta oportunidad",
					});
				}

				if (
					canAutoAttachBankStatementDocuments({
						userRole: context.userRole,
						userId: context.userId,
						opportunityAssignedTo: opportunity.assignedTo,
					})
				) {
					opportunityForDocuments = {
						id: opportunity.id,
						vehicleId: opportunity.vehicleId,
					};
				}
			}

			const uploadedKeys: string[] = [];
			const uploadedKeysToDelete = new Set<string>();
			let capacityReservation: {
				opportunityId: string;
				token: string;
			} | null = null;

			try {
				// 2. Validar archivos: descargar de R2 y verificar formato PDF
				const downloadedFiles: {
					name: string;
					key: string;
					buffer: Buffer;
					mimeType: string;
					size: number;
				}[] = [];
				for (const file of input.files) {
					const uploadedFile = await verifyUploadedDocumentInR2({
						key: file.key,
						expectedPrefix,
						filename: file.name,
						mimeType: file.mimeType,
						maxSizeBytes: MAX_FILE_SIZE_BYTES,
					});
					uploadedKeys.push(uploadedFile.key);
					const buffer = await getFileBuffer(uploadedFile.key);

					// Validate PDF magic bytes directly from buffer
					if (
						buffer.length < 4 ||
						buffer.subarray(0, 4).toString() !== "%PDF"
					) {
						throw new ORPCError("BAD_REQUEST", {
							message: `El archivo "${file.name}" no es un PDF válido.`,
						});
					}

					downloadedFiles.push({
						name: file.name,
						key: uploadedFile.key,
						buffer,
						mimeType: uploadedFile.mimeType,
						size: uploadedFile.size,
					});
				}

				const whereCondition = getCreditAnalysisOwnerCondition(owner);
				let currentAttemptCount: number;

				if (isForLead) {
					if (!input.opportunityId) {
						throw new ORPCError("BAD_REQUEST", {
							message: "Debe proporcionar opportunityId para analizar un lead",
						});
					}
					try {
						const reservation = await reserveCapacityAnalysis({
							opportunityId: input.opportunityId,
							leadId: input.leadId!,
							validationIds: input.integrityValidationIds ?? [],
							userId: context.userId,
							maxAttempts: MAX_AI_ATTEMPTS,
							files: downloadedFiles.map((file) => ({
								filePath: file.key,
								contentSha256: createHash("sha256")
									.update(file.buffer)
									.digest("hex"),
							})),
						});
						capacityReservation = {
							opportunityId: input.opportunityId,
							token: reservation.token,
						};
						currentAttemptCount = reservation.attemptCount;
					} catch (error) {
						if (error instanceof DocumentIntegrityError) {
							throw new ORPCError("PRECONDITION_FAILED", {
								message: error.message,
							});
						}
						throw error;
					}
				} else {
					// El flujo de codeudor no usa validación documental, pero conserva
					// su contador atómico existente.
					const updateResult = await db
						.update(creditAnalysis)
						.set({
							attemptCount: sql`${creditAnalysis.attemptCount} + 1`,
							updatedAt: new Date(),
						})
						.where(
							and(
								whereCondition,
								lt(creditAnalysis.attemptCount, MAX_AI_ATTEMPTS),
								isNull(creditAnalysis.analyzedAt),
							),
						)
						.returning({
							id: creditAnalysis.id,
							attemptCount: creditAnalysis.attemptCount,
						});

					if (updateResult.length > 0) {
						// Registro existente actualizado exitosamente
						currentAttemptCount = updateResult[0].attemptCount;
					} else {
						// No se actualizó: o no existe, o ya tiene análisis, o alcanzó el límite
						const existing = await db
							.select()
							.from(creditAnalysis)
							.where(whereCondition)
							.limit(1);

						if (existing.length === 0) {
							// No existe, crear nuevo registro
							const insertValues = {
								coDebtorId: input.coDebtorId!,
								attemptCount: 1,
								createdBy: context.userId,
							};

							const insertResult = await db
								.insert(creditAnalysis)
								.values(insertValues)
								.onConflictDoNothing() // En caso de race condition en insert
								.returning({ attemptCount: creditAnalysis.attemptCount });

							if (insertResult.length === 0) {
								// Hubo conflict, reintentar el update
								const retryUpdate = await db
									.update(creditAnalysis)
									.set({
										attemptCount: sql`${creditAnalysis.attemptCount} + 1`,
										updatedAt: new Date(),
									})
									.where(
										and(
											whereCondition,
											lt(creditAnalysis.attemptCount, MAX_AI_ATTEMPTS),
											isNull(creditAnalysis.analyzedAt),
										),
									)
									.returning({ attemptCount: creditAnalysis.attemptCount });

								if (retryUpdate.length === 0) {
									throw new ORPCError("PRECONDITION_FAILED", {
										message: `Se alcanzó el límite de ${MAX_AI_ATTEMPTS} intentos o ya existe un análisis exitoso.`,
									});
								}
								currentAttemptCount = retryUpdate[0].attemptCount;
							} else {
								currentAttemptCount = insertResult[0].attemptCount;
							}
						} else {
							// Existe pero no se pudo actualizar
							if (existing[0].analyzedAt !== null) {
								throw new ORPCError("PRECONDITION_FAILED", {
									message:
										"Ya existe un análisis exitoso para este co-deudor. No se permiten más intentos.",
								});
							}
							throw new ORPCError("PRECONDITION_FAILED", {
								message: `Se alcanzó el límite de ${MAX_AI_ATTEMPTS} intentos de análisis. Contacte al administrador.`,
							});
						}
					}
				}

				// 4. Construir content parts con los PDFs descargados de R2
				const fileParts = downloadedFiles.flatMap((file, fileIndex) => [
					{
						type: "text" as const,
						text: `Archivo índice ${fileIndex}: ${file.name}`,
					},
					{
						type: "file" as const,
						data: file.buffer,
						mediaType: "application/pdf" as const,
						filename: file.name,
					},
				]);

				// 5-8. La producción y las pruebas usan el mismo núcleo: una sola IA,
				// persistencia financiera y ciclo real de adjuntos.
				const initial = await runInitialBankStatementHandlerCore({
					generateAnalysis: async () => {
						try {
							const result = await generateObject({
								model: google("gemini-3-flash-preview"),
								schema: bankStatementAnalysisSchema,
								abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
								messages: [
									{ role: "system", content: BANK_ANALYSIS_PROMPT },
									{
										role: "user",
										content: [
											{
												type: "text",
												text: "Analiza los siguientes estados de cuenta bancarios:",
											},
											...fileParts,
										],
									},
								],
							});
							return result.object;
						} catch (error) {
							const isTimeout =
								error instanceof Error && error.name === "TimeoutError";
							console.error("Error en análisis de IA:", {
								leadId: input.leadId,
								attemptCount: currentAttemptCount,
								isTimeout,
								error: error instanceof Error ? error.message : String(error),
							});
							const remainingAttempts = MAX_AI_ATTEMPTS - currentAttemptCount;
							throw new ORPCError("INTERNAL_SERVER_ERROR", {
								message: `${isTimeout ? "El análisis tardó demasiado tiempo. " : ""}Error al analizar los documentos (intento ${currentAttemptCount}/${MAX_AI_ATTEMPTS}). ${
									remainingAttempts > 0
										? `Puede intentar ${remainingAttempts} vez más.`
										: "Se agotaron los intentos disponibles. Contacte al administrador."
								}`,
							});
						}
					},
					prepareAnalysis: async (generated) => {
						let analysis = generated;
						if (analysis.moneda === "MIXTA") {
							const mixedCurrencyCondition = capacityReservation
								? and(
										whereCondition,
										eq(
											creditAnalysis.analysisReservationToken,
											capacityReservation.token,
										),
									)
								: whereCondition;
							const releasedAttempt = await db
								.update(creditAnalysis)
								.set({
									attemptCount: sql`GREATEST(${creditAnalysis.attemptCount} - 1, 0)`,
									...(capacityReservation
										? {
												analysisReservationToken: null,
												analysisReservationStartedAt: null,
											}
										: {}),
									updatedAt: new Date(),
								})
								.where(mixedCurrencyCondition)
								.returning({ id: creditAnalysis.id });
							if (capacityReservation && releasedAttempt.length > 0) {
								capacityReservation = null;
							}
							throw new ORPCError("BAD_REQUEST", {
								message:
									"Los estados de cuenta subidos están en monedas distintas (quetzales y dólares). Analice por separado los de cada moneda. Este intento no se descontó.",
							});
						}
						if (analysis.moneda === "USD") {
							analysis = convertAnalysisToQuetzales(analysis);
						}
						if (analysis.analisis_fecha_pago) {
							analysis.analisis_fecha_pago.dias_pago_sugeridos = [
								...analysis.analisis_fecha_pago.dias_pago_sugeridos,
							].sort((a, b) => b.porcentaje - a.porcentaje);
						}
						const creditCapacity = calculateCreditCapacity(analysis, {
							annualRate: input.annualRate,
							termMonths: input.termMonths,
							maxDebtRatio: input.maxDebtRatio,
							maxVariableDebtRatio: input.maxVariableDebtRatio,
						});
						const resolvedCoverage = resolveBankStatementMonthlyCoverage({
							uploadedFileCount: downloadedFiles.length,
							coverageByFile: analysis.cobertura_por_archivo,
						});
						const coverage: PersistedBankStatementCoverage = {
							...resolvedCoverage,
							version: 1,
							analysisBatchId: randomUUID(),
							saveStatus: getInitialBankStatementCoverageSaveStatus({
								hasOpportunity: isForLead,
								canAutoAttach: !!opportunityForDocuments,
							}),
							requestedChecklistAssignments:
								resolvedCoverage.checklistAssignments,
							files: resolvedCoverage.files.map((fileCoverage) => {
								const file = downloadedFiles[fileCoverage.fileIndex];
								return {
									...fileCoverage,
									name: file.name,
									evidenceKey: file.key,
									contentSha256: createHash("sha256")
										.update(file.buffer)
										.digest("hex"),
									integrityValidationId:
										input.integrityValidationIds?.[fileCoverage.fileIndex],
									mimeType: file.mimeType,
									size: file.size,
								};
							}),
						};
						const fullAnalysis = {
							...analysis,
							archivos_analizados: downloadedFiles.map((file, fileIndex) => ({
								indice: fileIndex,
								nombre: file.name,
								tamano: file.size,
								tipo: file.mimeType,
							})),
							cobertura_mensual: coverage,
						};
						const completionCondition = capacityReservation
							? and(
									whereCondition,
									eq(
										creditAnalysis.analysisReservationToken,
										capacityReservation.token,
									),
								)
							: whereCondition;
						return {
							analysis,
							creditCapacity,
							coverage,
							fullAnalysis,
							completionCondition,
						};
					},
					persistAnalysis: async (prepared) => {
						const [completed] = await db
							.update(creditAnalysis)
							.set({
								fullAnalysis: JSON.stringify(prepared.fullAnalysis),
								monthlyFixedIncome:
									prepared.analysis.promedio_mensual.promedio_ingresos_fijos.toString(),
								monthlyVariableIncome:
									prepared.analysis.promedio_mensual.promedio_ingresos_variables.toString(),
								monthlyFixedExpenses:
									prepared.analysis.promedio_mensual.promedio_gastos_fijos.toString(),
								monthlyVariableExpenses:
									prepared.analysis.promedio_mensual.promedio_gastos_variables.toString(),
								economicAvailability:
									prepared.analysis.promedio_mensual.disponibilidad_economica.toString(),
								maxPayment: prepared.creditCapacity.maxPayment.toString(),
								maxCreditAmount:
									prepared.creditCapacity.maxCreditAmount.toString(),
								suggestedPaymentDays:
									prepared.analysis.analisis_fecha_pago?.dias_pago_sugeridos ??
									null,
								analyzedAt: new Date(),
								updatedAt: new Date(),
							})
							.where(prepared.completionCondition)
							.returning({ id: creditAnalysis.id });
						if (!completed) {
							throw new ORPCError("PRECONDITION_FAILED", {
								message:
									"La validación documental cambió mientras se analizaba la capacidad. Actualiza la pantalla e inténtalo nuevamente.",
							});
						}
					},
					validateCurrent: async () => {
						if (isForLead && !capacityReservation) {
							throw new ORPCError("PRECONDITION_FAILED", {
								message: "La reserva del análisis ya no está vigente.",
							});
						}
					},
					persistCoverage: async (updatedCoverage, prepared) => {
						prepared.fullAnalysis.cobertura_mensual = updatedCoverage;
						const [saved] = await db
							.update(creditAnalysis)
							.set({
								fullAnalysis: JSON.stringify(prepared.fullAnalysis),
								updatedAt: new Date(),
							})
							.where(prepared.completionCondition)
							.returning({ id: creditAnalysis.id });
						if (!saved) {
							throw new ORPCError("PRECONDITION_FAILED", {
								message:
									"El lote de análisis cambió antes de guardar la cobertura.",
							});
						}
					},
					cleanupDebt: async () => [],
					saveArtifacts: async (coverageToSave) => {
						if (!(opportunityForDocuments && capacityReservation)) {
							throw new Error(
								"El guardado de adjuntos no aplica a este análisis.",
							);
						}
						return saveBankCoverageDocuments({
							opportunityId: opportunityForDocuments.id,
							vehicleId: opportunityForDocuments.vehicleId,
							userId: context.userId,
							reservationToken: capacityReservation.token,
							coverage: coverageToSave,
							buffers: new Map(
								downloadedFiles.map((file, fileIndex) => [
									fileIndex,
									file.buffer,
								]),
							),
						});
					},
				});
				return {
					analysis: initial.analysis,
					creditCapacity: initial.creditCapacity,
					coverage: toPublicBankStatementCoverage(initial.coverage),
				};
			} finally {
				if (capacityReservation) {
					try {
						await releaseCapacityAnalysisReservation(capacityReservation);
					} catch (error) {
						console.error("Failed to release capacity analysis reservation", {
							resourceId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}
				const cleanupKeys = isForLead
					? [...uploadedKeysToDelete]
					: uploadedKeys;
				const cleanupResults = await Promise.allSettled(
					cleanupKeys.map((key) => deleteFileFromR2(key)),
				);
				const failedDeletes = cleanupResults.filter(
					(result) => result.status === "rejected",
				);

				if (failedDeletes.length > 0) {
					console.error("Failed to cleanup bank statement uploads from R2", {
						resourceId,
						keys: cleanupKeys,
						failedDeletes: failedDeletes.length,
					});
				}
			}
		}),

	retryBankStatementCoverageSave: crmProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				opportunityId: z.string().uuid(),
				analysisId: z.string().uuid(),
				analysisBatchId: z.string().uuid(),
			}),
		)
		.handler(({ input, context }) =>
			mutatePersistedBankCoverage({
				...input,
				userId: context.userId,
				userRole: context.userRole,
			}),
		),

	confirmBankStatementCoverage: crmProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				opportunityId: z.string().uuid(),
				analysisId: z.string().uuid(),
				analysisBatchId: z.string().uuid(),
				fileIndex: z.number().int().min(0).max(8),
				months: z
					.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/))
					.min(1)
					.max(36),
			}),
		)
		.handler(({ input, context }) =>
			mutatePersistedBankCoverage({
				leadId: input.leadId,
				opportunityId: input.opportunityId,
				analysisId: input.analysisId,
				analysisBatchId: input.analysisBatchId,
				userId: context.userId,
				userRole: context.userRole,
				manualDeclaration: {
					fileIndex: input.fileIndex,
					months: input.months,
				},
			}),
		),
};
