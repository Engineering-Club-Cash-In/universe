import { google } from "@ai-sdk/google";
import { ORPCError } from "@orpc/server";
import { generateObject } from "ai";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { opportunityDocuments } from "../db/schema/documents";
import {
	coDebtors,
	creditAnalysis,
	leads,
	opportunities,
} from "../db/schema/crm";
import {
	BANK_ANALYSIS_PROMPT,
	bankStatementAnalysisSchema,
} from "../lib/bank-analysis-schema";
import {
	canAutoAttachBankStatementDocuments,
	getBankStatementOpportunityDocumentType,
} from "../lib/bank-statement-documents";
import { updateChecklistForClientDocument } from "../lib/checklist";
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

const MAX_AI_ATTEMPTS = 2;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB por archivo
const AI_TIMEOUT_MS = 120_000; // 2 minutos timeout para la IA

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
					annualRate: z.number().default(0.18),
					termMonths: z.number().int().min(12).max(120).default(60),
					maxDebtRatio: z.number().min(0).max(1).default(0.2),
					maxVariableDebtRatio: z.number().min(0).max(1).default(0.2),
					opportunityId: z.string().uuid().optional(),
				})
				.refine((data) => data.leadId || data.coDebtorId, {
					message: "Debe proporcionar leadId o coDebtorId",
				}),
		)
		.handler(async ({ input, context }) => {
			const isForLead = !!input.leadId;
			const resourceId = input.leadId || input.coDebtorId!;
			const expectedPrefix = buildUploadPrefix("bank_statement", resourceId);

			// 1. Verificar que el lead/co-deudor existe y el usuario tiene acceso
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

				if (
					context.userRole === "sales" &&
					lead[0].assignedTo !== context.userId
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para analizar este lead",
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

			if (isForLead && input.opportunityId) {
				const [opportunity] = await db
					.select({
						id: opportunities.id,
						leadId: opportunities.leadId,
						vehicleId: opportunities.vehicleId,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);

				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}

				if (opportunity.leadId !== input.leadId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad no pertenece al lead analizado",
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

			try {
				// 2. Validar archivos: descargar de R2 y verificar formato PDF
				const downloadedFiles: {
					name: string;
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
						buffer,
						mimeType: uploadedFile.mimeType,
						size: uploadedFile.size,
					});
				}

				// 3. Incremento atómico del contador para evitar race conditions
				const whereCondition = isForLead
					? eq(creditAnalysis.leadId, input.leadId!)
					: eq(creditAnalysis.coDebtorId, input.coDebtorId!);

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

				let currentAttemptCount: number;

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
						const insertValues = isForLead
							? {
									leadId: input.leadId!,
									attemptCount: 1,
									createdBy: context.userId,
								}
							: {
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
								message: `Ya existe un análisis exitoso para este ${isForLead ? "lead" : "co-deudor"}. No se permiten más intentos.`,
							});
						}
						throw new ORPCError("PRECONDITION_FAILED", {
							message: `Se alcanzó el límite de ${MAX_AI_ATTEMPTS} intentos de análisis. Contacte al administrador.`,
						});
					}
				}

				// 4. Construir content parts con los PDFs descargados de R2
				const fileParts = downloadedFiles.map((file) => ({
					type: "file" as const,
					data: file.buffer,
					mediaType: "application/pdf" as const,
					filename: file.name,
				}));

				// 5. Llamar a Gemini con generateObject (aquí es donde cuesta dinero)
				let analysis: Awaited<
					ReturnType<typeof generateObject<typeof bankStatementAnalysisSchema>>
				>["object"];

				try {
					const result = await generateObject({
						model: google("gemini-3-flash-preview"),
						schema: bankStatementAnalysisSchema,
						abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
						messages: [
							{
								role: "system",
								content: BANK_ANALYSIS_PROMPT,
							},
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
					analysis = result.object;
				} catch (error) {
					// El intento ya se contó, informar al usuario del error
					const isTimeout =
						error instanceof Error && error.name === "TimeoutError";
					console.error("Error en análisis de IA:", {
						leadId: input.leadId,
						attemptCount: currentAttemptCount,
						isTimeout,
						error: error instanceof Error ? error.message : String(error),
					});

					const remainingAttempts = MAX_AI_ATTEMPTS - currentAttemptCount;
					const timeoutMsg = isTimeout
						? "El análisis tardó demasiado tiempo. "
						: "";
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: `${timeoutMsg}Error al analizar los documentos (intento ${currentAttemptCount}/${MAX_AI_ATTEMPTS}). ${
							remainingAttempts > 0
								? `Puede intentar ${remainingAttempts} vez más.`
								: "Se agotaron los intentos disponibles. Contacte al administrador."
						}`,
					});
				}

				// 6. Calcular capacidad crediticia
				const creditCapacity = calculateCreditCapacity(analysis, {
					annualRate: input.annualRate,
					termMonths: input.termMonths,
					maxDebtRatio: input.maxDebtRatio,
					maxVariableDebtRatio: input.maxVariableDebtRatio,
				});

				// 7. Actualizar con los resultados del análisis exitoso
				await db
					.update(creditAnalysis)
					.set({
						fullAnalysis: JSON.stringify(analysis),
						monthlyFixedIncome:
							analysis.promedio_mensual.promedio_ingresos_fijos.toString(),
						monthlyVariableIncome:
							analysis.promedio_mensual.promedio_ingresos_variables.toString(),
						monthlyFixedExpenses:
							analysis.promedio_mensual.promedio_gastos_fijos.toString(),
						monthlyVariableExpenses:
							analysis.promedio_mensual.promedio_gastos_variables.toString(),
						economicAvailability:
							analysis.promedio_mensual.disponibilidad_economica.toString(),
						maxPayment: creditCapacity.maxPayment.toString(),
						maxCreditAmount: creditCapacity.maxCreditAmount.toString(),
						analyzedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(whereCondition);

				if (opportunityForDocuments) {
					const savedDocuments: { id: string; documentType: string }[] = [];
					const savedKeys: string[] = [];

					try {
						for (const [index, file] of downloadedFiles.entries()) {
							const documentType = getBankStatementOpportunityDocumentType(index);
							if (!documentType) {
								continue;
							}

							const uniqueFilename = generateUniqueFilename(file.name);
							const { key } = await uploadFileToR2(
								new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
								uniqueFilename,
								opportunityForDocuments.id,
							);
							savedKeys.push(key);

							const [newDocument] = await db
								.insert(opportunityDocuments)
								.values({
									opportunityId: opportunityForDocuments.id,
									filename: uniqueFilename,
									originalName: file.name,
									mimeType: file.mimeType,
									size: file.size,
									documentType,
									description:
										"Guardado automáticamente desde análisis de capacidad de pago",
									uploadedBy: context.userId,
									filePath: key,
								})
								.returning({ id: opportunityDocuments.id });

							if (newDocument) {
								savedDocuments.push({ id: newDocument.id, documentType });
								await updateChecklistForClientDocument(
									opportunityForDocuments.id,
									documentType,
									newDocument.id,
									!!opportunityForDocuments.vehicleId,
									opportunityForDocuments.vehicleId || undefined,
								);
							}
						}
					} catch (error) {
						const cleanupResults = await Promise.allSettled([
							...savedDocuments.map(({ id }) =>
								db
									.delete(opportunityDocuments)
									.where(eq(opportunityDocuments.id, id)),
							),
							...savedKeys.map((key) => deleteFileFromR2(key)),
						]);
						const failedCleanups = cleanupResults.filter(
							(result) => result.status === "rejected",
						);
						await Promise.allSettled(
							savedDocuments.map(({ id, documentType }) =>
								updateChecklistForClientDocument(
									opportunityForDocuments.id,
									documentType,
									id,
									!!opportunityForDocuments.vehicleId,
									opportunityForDocuments.vehicleId || undefined,
								),
							),
						);

						console.error("Failed to save bank statement opportunity documents", {
							opportunityId: opportunityForDocuments.id,
							savedDocuments: savedDocuments.length,
							savedFiles: savedKeys.length,
							failedCleanups: failedCleanups.length,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				// 8. Retornar resultados
				return {
					analysis,
					creditCapacity,
				};
			} finally {
				const cleanupResults = await Promise.allSettled(
					uploadedKeys.map((key) => deleteFileFromR2(key)),
				);
				const failedDeletes = cleanupResults.filter(
					(result) => result.status === "rejected",
				);

				if (failedDeletes.length > 0) {
					console.error("Failed to cleanup bank statement uploads from R2", {
						resourceId,
						keys: uploadedKeys,
						failedDeletes: failedDeletes.length,
					});
				}
			}
		}),
};
