import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	canAutoAttachBankStatementDocuments,
	type ResolvedBankStatementCoverage,
	resolveBankStatementMonthlyCoverage,
} from "../lib/bank-statement-documents";
import { canWriteOpportunityCreditAnalysis } from "../lib/credit-analysis-ownership";
import { runCreditAnalysisResetReservationCore } from "../services/document-integrity";
import {
	getInitialBankStatementCoverageSaveStatus,
	type PersistedBankStatementCoverage,
	runBankStatementArtifactPersistenceCore,
	runBankStatementCleanupDebtCore,
	runBankStatementCoverageMutationHandlerCore,
	runBankStatementCoverageSaveLifecycle,
	runInitialBankStatementHandlerCore,
	runOpportunityCreditAnalysisResetCore,
} from "./bank-analysis-coverage";

const resolved: ResolvedBankStatementCoverage = {
	status: "detected",
	months: [{ month: "2026-01", sourceFileIndexes: [0] }],
	files: [
		{
			fileIndex: 0,
			status: "detected",
			detectedMonths: ["2026-01"],
			effectiveMonths: ["2026-01"],
		},
	],
	checklistAssignments: [
		{ month: "2026-01", fileIndex: 0, sourceFileIndexes: [0] },
	],
	manualDeclarations: [],
	reportedCoverage: [{ indice_archivo: 0, meses: ["2026-01"] }],
	issues: [],
};

const resetReservationAdapters = () => ({
	reserveReset: async () => ({
		analysisId: "analysis-1",
		token: "reset-token",
	}),
	releaseReset: async () => {},
	assertResetCurrent: async () => {},
});

const coverage = (
	saveStatus: PersistedBankStatementCoverage["saveStatus"] = "pending",
): PersistedBankStatementCoverage => ({
	...resolved,
	version: 1,
	analysisBatchId: "11111111-1111-4111-8111-111111111111",
	saveStatus,
	files: [
		{
			...resolved.files[0],
			name: "enero.pdf",
			evidenceKey: "bank_statement/opportunity/validated/enero.pdf",
			contentSha256: "a".repeat(64),
			integrityValidationId: "22222222-2222-4222-8222-222222222222",
		},
	],
});

describe("bank analysis route orchestration", () => {
	test("initial production core calls AI once and persists financial then attachment transitions", async () => {
		const generate = mock(async () => ({ moneda: "GTQ" }));
		const transitions: string[] = [];
		const result = await runInitialBankStatementHandlerCore({
			generateAnalysis: generate,
			prepareAnalysis: async (analysis) => ({
				analysis,
				coverage: coverage(),
			}),
			persistAnalysis: async () => {
				transitions.push("financial-analysis");
			},
			validateCurrent: async () => {
				transitions.push("validate-current-batch");
			},
			persistCoverage: async (value) => {
				transitions.push(value.saveStatus);
			},
			cleanupDebt: async () => [],
			saveArtifacts: async () => ({
				documents: [],
				effectiveAssignments: resolved.checklistAssignments,
				pendingAssignments: [],
			}),
		});

		expect(generate).toHaveBeenCalledTimes(1);
		expect(result.analysis).toEqual({ moneda: "GTQ" });
		expect(result.coverage.saveStatus).toBe("saved");
		expect(transitions).toEqual([
			"financial-analysis",
			"validate-current-batch",
			"pending",
			"saved",
		]);
	});

	test("production mutation core executes retry and confirmation without AI and persists current-batch state", async () => {
		const generate = mock(async () => ({ moneda: "GTQ" }));
		const persistStatuses: string[] = [];
		const saveFromCoverage = async (
			coverageToSave: PersistedBankStatementCoverage,
		) => {
			let nextId = 0;
			return runBankStatementArtifactPersistenceCore({
				coverage: coverageToSave,
				loadExistingDocuments: async () => [],
				readStoredFile: async () => Buffer.from("unused"),
				createArtifact: async (artifact) => ({
					...artifact,
					id: `33333333-3333-4333-8333-${String(++nextId).padStart(12, "0")}`,
					filePath: `opportunities/opportunity/${nextId}.pdf`,
				}),
				reuseArtifact: async (existing, artifact) => ({
					...artifact,
					id: existing.id,
					filePath: existing.filePath,
				}),
				promoteArtifact: async (artifact) => artifact,
				linkArtifacts: async () => {},
				refreshChecklist: async () => {},
				rollbackArtifact: async () => {},
				rollbackReusedArtifact: async () => {},
				quarantineArtifact: async () => {},
				retireArtifact: async () => {},
			});
		};

		const retried = await runBankStatementCoverageMutationHandlerCore({
			coverage: coverage("failed"),
			actorId: "user-1",
			declaredAt: "2026-09-17T16:00:00.000Z",
			validateCurrent: async () => {},
			persistCoverage: async (value) => {
				persistStatuses.push(`retry:${value.saveStatus}`);
			},
			cleanupDebt: async () => [],
			saveArtifacts: saveFromCoverage,
		});
		expect(retried.saveStatus).toBe("saved");

		const ambiguous: PersistedBankStatementCoverage = {
			...coverage("saved"),
			status: "needs_confirmation",
			months: [],
			checklistAssignments: [],
			requestedChecklistAssignments: [],
			files: [
				{
					...coverage().files[0],
					status: "needs_confirmation",
					detectedMonths: ["Enero a abril"],
					effectiveMonths: [],
				},
			],
			reportedCoverage: [{ indice_archivo: 0, meses: ["Enero a abril"] }],
		};
		const confirmed = await runBankStatementCoverageMutationHandlerCore({
			coverage: ambiguous,
			manualDeclaration: {
				fileIndex: 0,
				months: ["2026-01", "2026-02", "2026-03", "2026-04"],
			},
			actorId: "user-1",
			declaredAt: "2026-09-17T16:00:00.000Z",
			validateCurrent: async () => {},
			persistCoverage: async (value) => {
				persistStatuses.push(`confirm:${value.saveStatus}`);
			},
			cleanupDebt: async () => [],
			saveArtifacts: saveFromCoverage,
		});

		expect(generate).toHaveBeenCalledTimes(0);
		expect(confirmed.months.map(({ month }) => month)).toEqual([
			"2026-01",
			"2026-02",
			"2026-03",
			"2026-04",
		]);
		expect(confirmed.checklistAssignments).toHaveLength(3);
		expect(confirmed.manualDeclarations[0]?.actorId).toBe("user-1");
		expect(persistStatuses).toEqual([
			"retry:pending",
			"retry:saved",
			"confirm:pending",
			"confirm:saved",
		]);
	});

	test("analysis authorization stays separate from attachment applicability", () => {
		expect(
			canWriteOpportunityCreditAnalysis("juridico", "user-1", "user-2"),
		).toBe(true);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "juridico",
				userId: "user-1",
				opportunityAssignedTo: "user-2",
			}),
		).toBe(false);
		expect(
			getInitialBankStatementCoverageSaveStatus({
				hasOpportunity: true,
				canAutoAttach: false,
			}),
		).toBe("not_applicable");
		expect(
			getInitialBankStatementCoverageSaveStatus({
				hasOpportunity: false,
				canAutoAttach: false,
			}),
		).toBe("not_applicable");
		expect(
			getInitialBankStatementCoverageSaveStatus({
				hasOpportunity: true,
				canAutoAttach: true,
			}),
		).toBe("pending");
	});

	test("executes injected R2, DB, validation-link, and checklist adapters and persists real fullAnalysis transitions", async () => {
		const events: string[] = [];
		const fullAnalysisWrites: string[] = [];
		const sourceCoverage = coverage();
		const rows: Array<{
			id: string;
			documentType: string;
			description: string | null;
			filePath: string;
		}> = [];

		const result = await runBankStatementCoverageSaveLifecycle({
			coverage: sourceCoverage,
			validateCurrent: async () => {
				events.push("ownership/analysis/batch/latest-integrity");
			},
			persistCoverage: async (value) => {
				fullAnalysisWrites.push(JSON.stringify({ cobertura_mensual: value }));
			},
			cleanupDebt: async () => [],
			saveArtifacts: (coverageToSave) =>
				runBankStatementArtifactPersistenceCore({
					coverage: coverageToSave,
					loadExistingDocuments: async () => rows,
					readStoredFile: async () => Buffer.from("unused"),
					createArtifact: async (artifact) => {
						events.push("r2-upload");
						events.push("db-insert-other");
						const id = "33333333-3333-4333-8333-333333333333";
						const filePath = "opportunities/opportunity/enero.pdf";
						rows.push({
							id,
							documentType: "other",
							description: "[bank-coverage-debt:batch:staging]",
							filePath,
						});
						return { ...artifact, id, filePath };
					},
					reuseArtifact: async (existing, artifact) => ({
						...artifact,
						id: existing.id,
						filePath: existing.filePath,
					}),
					commitArtifacts: async (artifacts) => {
						events.push("db-promote-and-checklist-commit");
						for (const artifact of artifacts) {
							const row = rows.find(({ id }) => id === artifact.id);
							if (!row) throw new Error("missing row");
							row.documentType = artifact.documentType;
							row.description = artifact.description;
						}
						return artifacts;
					},
					promoteArtifact: async (artifact) => artifact,
					linkArtifacts: async () => {
						events.push("validation-link");
					},
					refreshChecklist: async () => {
						events.push("rollback-checklist-refresh");
					},
					rollbackArtifact: async () => {
						events.push("rollback");
					},
					rollbackReusedArtifact: async () => {},
					quarantineArtifact: async () => {},
					retireArtifact: async () => {},
				}),
		});

		expect(result.saveStatus).toBe("saved");
		expect(
			fullAnalysisWrites.map(
				(value) => JSON.parse(value).cobertura_mensual.saveStatus,
			),
		).toEqual(["pending", "saved"]);
		expect(rows.map(({ documentType }) => documentType)).toEqual([
			"estados_cuenta_1",
		]);
		expect(events).toEqual([
			"ownership/analysis/batch/latest-integrity",
			"r2-upload",
			"db-insert-other",
			"validation-link",
			"db-promote-and-checklist-commit",
		]);
	});

	test("persists only effective foreign-slot assignments and leaves overflow pending", async () => {
		const source = {
			...coverage(),
			requestedChecklistAssignments: [
				{ month: "2026-01", fileIndex: 0, sourceFileIndexes: [0] },
				{ month: "2026-02", fileIndex: 0, sourceFileIndexes: [0] },
				{ month: "2026-03", fileIndex: 0, sourceFileIndexes: [0] },
			],
		};
		const effectiveAssignments = [
			{
				...source.requestedChecklistAssignments[0],
				documentType: "estados_cuenta_2" as const,
			},
			{
				...source.requestedChecklistAssignments[1],
				documentType: "estados_cuenta_3" as const,
			},
		];
		const result = await runBankStatementCoverageSaveLifecycle({
			coverage: source,
			validateCurrent: async () => {},
			persistCoverage: async () => {},
			cleanupDebt: async () => [],
			saveArtifacts: async () => ({
				documents: [],
				effectiveAssignments,
				pendingAssignments: [source.requestedChecklistAssignments[2]],
			}),
		});

		expect(result.saveStatus).toBe("pending");
		expect(result.checklistAssignments).toEqual(effectiveAssignments);
		expect(result.pendingChecklistAssignments).toEqual([
			source.requestedChecklistAssignments[2],
		]);
	});

	test("sequential occupancy drift stays pending or converges to unique exact checklist types", async () => {
		const bytes = Buffer.from("same analyzed PDF");
		const hash = createHash("sha256").update(bytes).digest("hex");
		const resolvedThree = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [
				{
					indice_archivo: 0,
					meses: ["2026-01", "2026-02", "2026-03"],
				},
			],
		});
		const source: PersistedBankStatementCoverage = {
			...resolvedThree,
			version: 1,
			analysisBatchId: "11111111-1111-4111-8111-111111111111",
			saveStatus: "pending",
			requestedChecklistAssignments: resolvedThree.checklistAssignments,
			files: [
				{
					...resolvedThree.files[0],
					name: "trimestre.pdf",
					evidenceKey: "bank_statement/opportunity/validated/trimestre.pdf",
					contentSha256: hash,
					integrityValidationId: "22222222-2222-4222-8222-222222222222",
				},
			],
		};
		const rows: Array<{
			id: string;
			documentType: string;
			description: string | null;
			filePath: string;
			foreign?: boolean;
		}> = [
			{
				id: "manual-1",
				documentType: "estados_cuenta_1",
				description: "Adjunto manual",
				filePath: "opportunities/opportunity/manual.pdf",
				foreign: true,
			},
		];
		let idSequence = 0;
		const saveArtifacts = (coverageToSave: PersistedBankStatementCoverage) =>
			runBankStatementArtifactPersistenceCore({
				coverage: coverageToSave,
				loadExistingDocuments: async () => rows,
				readStoredFile: async () => bytes,
				createArtifact: async (artifact) => {
					const id = `auto-${++idSequence}`;
					const filePath = `opportunities/opportunity/${id}.pdf`;
					rows.push({
						id,
						documentType: "other",
						description: `[bank-coverage-debt:${artifact.analysisBatchId}:staging:file:${artifact.fileIndex}]`,
						filePath,
					});
					return { ...artifact, id, filePath };
				},
				reuseArtifact: async (existing, artifact) => ({
					...artifact,
					id: existing.id,
					filePath: existing.filePath,
				}),
				promoteArtifact: async (artifact) => {
					const row = rows.find(({ id }) => id === artifact.id);
					if (!row) throw new Error("missing row");
					row.documentType = artifact.documentType;
					row.description = artifact.description;
					return artifact;
				},
				linkArtifacts: async () => {},
				refreshChecklist: async () => {},
				rollbackArtifact: async () => {},
				rollbackReusedArtifact: async () => {},
				quarantineArtifact: async () => {},
				retireArtifact: async (artifact) => {
					const index = rows.findIndex(({ id }) => id === artifact.id);
					if (index >= 0) rows.splice(index, 1);
				},
			});
		const execute = (current: PersistedBankStatementCoverage) =>
			runBankStatementCoverageMutationHandlerCore({
				coverage: current,
				actorId: "user-1",
				declaredAt: "2026-09-17T16:00:00.000Z",
				validateCurrent: async () => {},
				persistCoverage: async () => {},
				cleanupDebt: async () => [],
				saveArtifacts,
			});

		const occupied = await execute(source);
		expect(occupied.saveStatus).toBe("pending");
		expect(occupied.pendingChecklistAssignments).toHaveLength(1);
		expect(
			rows
				.filter(({ foreign }) => !foreign)
				.map(({ documentType }) => documentType),
		).toEqual(["estados_cuenta_2", "estados_cuenta_3"]);

		rows.splice(
			rows.findIndex(({ foreign }) => foreign === true),
			1,
		);
		const freed = await execute(occupied);
		expect(freed.saveStatus).toBe("saved");
		expect(rows.map(({ documentType }) => documentType).sort()).toEqual([
			"estados_cuenta_1",
			"estados_cuenta_2",
			"estados_cuenta_3",
		]);

		rows.push({
			id: "manual-new-1",
			documentType: "estados_cuenta_1",
			description: "Adjunto manual nuevo",
			filePath: "opportunities/opportunity/manual-new.pdf",
			foreign: true,
		});
		const occupiedAgain = await execute(freed);
		expect(occupiedAgain.saveStatus).toBe("pending");
		expect(occupiedAgain.pendingChecklistAssignments).toHaveLength(1);
		const activeTypes = rows
			.filter(({ documentType }) => documentType !== "other")
			.map(({ documentType }) => documentType);
		expect(activeTypes.sort()).toEqual([
			"estados_cuenta_1",
			"estados_cuenta_2",
			"estados_cuenta_3",
		]);
		expect(new Set(activeTypes).size).toBe(activeTypes.length);
	});

	test("persists failed debt while a link-failed row stays quarantined from checklist approval", async () => {
		const persisted: PersistedBankStatementCoverage[] = [];
		const rows: Array<{
			id: string;
			documentType: string;
			description: string | null;
			filePath: string;
		}> = [];
		let checklistUploaded = false;
		const result = await runBankStatementCoverageSaveLifecycle({
			coverage: coverage(),
			validateCurrent: async () => {},
			persistCoverage: async (value) => {
				persisted.push(value);
			},
			cleanupDebt: async () => [],
			saveArtifacts: (coverageToSave) =>
				runBankStatementArtifactPersistenceCore({
					coverage: coverageToSave,
					loadExistingDocuments: async () => rows,
					readStoredFile: async () => Buffer.from("unused"),
					createArtifact: async (artifact) => {
						const row = {
							id: "33333333-3333-4333-8333-333333333333",
							documentType: "other",
							description: `[bank-coverage-debt:${artifact.analysisBatchId}:staging:file:${artifact.fileIndex}]`,
							filePath: "opportunities/opportunity/current-batch.pdf",
						};
						rows.push(row);
						return { ...artifact, id: row.id, filePath: row.filePath };
					},
					reuseArtifact: async (existing, artifact) => ({
						...artifact,
						id: existing.id,
						filePath: existing.filePath,
					}),
					promoteArtifact: async (artifact) => artifact,
					linkArtifacts: async () => {
						throw new Error("link failed");
					},
					refreshChecklist: async () => {
						checklistUploaded = rows.some(
							({ documentType, description }) =>
								documentType.startsWith("estados_cuenta_") &&
								!description?.startsWith("[bank-coverage-debt:"),
						);
					},
					rollbackArtifact: async () => {
						throw new Error("R2 delete failed");
					},
					rollbackReusedArtifact: async () => {},
					quarantineArtifact: async (artifact, cleanupTag) => {
						const row = rows.find(({ id }) => id === artifact.id);
						if (!row) throw new Error("missing row");
						row.documentType = "other";
						row.description = cleanupTag;
					},
					retireArtifact: async () => {},
				}),
		});

		expect(persisted.map(({ saveStatus }) => saveStatus)).toEqual([
			"pending",
			"failed",
		]);
		expect(result.cleanupDebt).toEqual([
			{
				status: "pending",
				key: "opportunities/opportunity/current-batch.pdf",
				artifactId: "33333333-3333-4333-8333-333333333333",
			},
		]);
		expect(rows[0]?.documentType).toBe("other");
		expect(rows[0]?.description).toStartWith("[bank-coverage-debt:");
		expect(checklistUploaded).toBe(false);
	});

	test("refreshes checklist immediately after debt deletion even when later evidence loading fails", async () => {
		const calls: string[] = [];
		let row:
			| {
					id: string;
					description: string;
					filePath: string;
			  }
			| undefined = {
			id: "33333333-3333-4333-8333-333333333333",
			description:
				"[bank-coverage-debt:11111111-1111-4111-8111-111111111111:artifact:33333333-3333-4333-8333-333333333333:file:0]",
			filePath: "opportunities/opportunity-1/current-batch.pdf",
		};
		const indebted = {
			...coverage("failed"),
			cleanupDebt: [
				{
					status: "pending" as const,
					key: row.filePath,
					artifactId: row.id,
				},
			],
		};
		const result = await runBankStatementCoverageSaveLifecycle({
			coverage: indebted,
			validateCurrent: async () => {
				calls.push("ownership/batch/integrity");
			},
			persistCoverage: async (value) => {
				calls.push(`persist:${value.saveStatus}`);
			},
			cleanupDebt: (debt) =>
				runBankStatementCleanupDebtCore({
					opportunityId: "opportunity-1",
					analysisBatchId: indebted.analysisBatchId,
					debt,
					readArtifact: async () => row ?? null,
					deleteStoredFile: async () => {
						calls.push("r2-delete");
					},
					deleteArtifact: async () => {
						calls.push("db-delete");
						row = undefined;
					},
					refreshChecklist: async () => {
						calls.push("checklist-refresh");
					},
				}),
			saveArtifacts: async () => {
				calls.push("evidence-load-failed");
				throw new Error("evidence unavailable");
			},
		});

		expect(result.saveStatus).toBe("failed");
		expect(row).toBeUndefined();
		expect(calls).toEqual([
			"ownership/batch/integrity",
			"persist:pending",
			"r2-delete",
			"db-delete",
			"checklist-refresh",
			"evidence-load-failed",
			"persist:failed",
		]);
	});

	test("stale reset reservation commits before global reset adapters mutate the analysis row", async () => {
		const state = {
			analysisId: "analysis-1",
			reservationToken: "stale-token" as string | null,
			stale: true,
			analysisExists: true,
		};
		let transactionActive = false;
		let reservationCommitted = false;
		const reserveReset = () =>
			runCreditAnalysisResetReservationCore({
				runTransaction: async (operation) => {
					expect(transactionActive).toBe(false);
					transactionActive = true;
					try {
						return await operation({ name: "short-reset-reservation" });
					} finally {
						transactionActive = false;
						reservationCommitted = true;
					}
				},
				lockOpportunity: async () => {
					expect(transactionActive).toBe(true);
				},
				clearStaleReservation: async () => {
					if (state.stale) state.reservationToken = null;
				},
				readAnalysis: async () =>
					state.analysisExists
						? {
								id: state.analysisId,
								reservationToken: state.reservationToken,
							}
						: null,
				reserveAnalysis: async (_tx, analysisId, token) => {
					if (analysisId !== state.analysisId || state.reservationToken) {
						return false;
					}
					state.reservationToken = token;
					return true;
				},
				createToken: () => "reset-token",
			});

		const result = await runOpportunityCreditAnalysisResetCore({
			opportunityId: "opportunity-1",
			reserveReset,
			releaseReset: async ({ token }) => {
				if (state.reservationToken === token) state.reservationToken = null;
			},
			assertResetCurrent: async ({ token }) => {
				expect(transactionActive).toBe(false);
				expect(reservationCommitted).toBe(true);
				expect(state.reservationToken).toBe(token);
			},
			loadAnalysis: async ({ analysisId, token }) => {
				expect(transactionActive).toBe(false);
				expect(reservationCommitted).toBe(true);
				expect(state.reservationToken).toBe(token);
				return state.analysisExists && analysisId === state.analysisId
					? { id: analysisId, coverage: null }
					: null;
			},
			loadDocuments: async () => [],
			persistRecovery: async () => {
				throw new Error("not expected for historical analysis");
			},
			quarantineArtifactsAndRefresh: async () => {},
			deleteStoredFile: async () => {},
			deleteArtifactAndRefresh: async () => {},
			deleteAnalysis: async (_analysisId, { token }) => {
				expect(transactionActive).toBe(false);
				expect(reservationCommitted).toBe(true);
				expect(state.reservationToken).toBe(token);
				state.analysisExists = false;
			},
		});

		expect(result).toEqual({ id: "analysis-1" });
		expect(state.analysisExists).toBe(false);
		expect(state.reservationToken).toBe(null);
	});

	test("fresh active reservation blocks reset before cleanup adapters run", async () => {
		let reserveCalled = false;
		let cleanupCalled = false;
		await expect(
			runOpportunityCreditAnalysisResetCore({
				opportunityId: "opportunity-1",
				reserveReset: () =>
					runCreditAnalysisResetReservationCore({
						runTransaction: async (operation) => operation({ name: "tx" }),
						lockOpportunity: async () => {},
						clearStaleReservation: async () => {},
						readAnalysis: async () => ({
							id: "analysis-1",
							reservationToken: "fresh-active-token",
						}),
						reserveAnalysis: async () => {
							reserveCalled = true;
							return true;
						},
						createToken: () => "reset-token",
					}),
				releaseReset: async () => {},
				assertResetCurrent: async () => {
					cleanupCalled = true;
				},
				loadAnalysis: async () => {
					cleanupCalled = true;
					return null;
				},
				loadDocuments: async () => {
					cleanupCalled = true;
					return [];
				},
				persistRecovery: async () => {
					cleanupCalled = true;
				},
				quarantineArtifactsAndRefresh: async () => {
					cleanupCalled = true;
				},
				deleteStoredFile: async () => {
					cleanupCalled = true;
				},
				deleteArtifactAndRefresh: async () => {
					cleanupCalled = true;
				},
				deleteAnalysis: async () => {
					cleanupCalled = true;
				},
			}),
		).rejects.toThrow("análisis de capacidad en proceso");
		expect(reserveCalled).toBe(false);
		expect(cleanupCalled).toBe(false);
	});

	test("successful coverage resets exact current-batch artifacts before a new batch claims all three slots", async () => {
		const oldBatch = "11111111-1111-4111-8111-111111111111";
		const newBatch = "44444444-4444-4444-8444-444444444444";
		const rows = [1, 2, 3].map((slot) => ({
			id: `old-${slot}`,
			documentType: `estados_cuenta_${slot}`,
			description: `[bank-coverage:${oldBatch}:type:estados_cuenta_${slot}:file:0:month:2026-0${slot}]`,
			filePath: `opportunities/opportunity-1/old-${slot}.pdf`,
		}));
		const blobs = new Set(rows.map(({ filePath }) => filePath));
		const checklist = { uploaded: true };
		let analysisExists = true;
		let persistedCoverage: PersistedBankStatementCoverage | undefined;
		const oldCoverage = {
			...coverage("saved"),
			analysisBatchId: oldBatch,
			savedDocuments: rows.map((row, index) => ({
				id: row.id,
				tag: row.description.slice(0, row.description.indexOf("]") + 1),
				fileIndex: 0,
				documentType: `estados_cuenta_${index + 1}` as
					| "estados_cuenta_1"
					| "estados_cuenta_2"
					| "estados_cuenta_3",
				month: `2026-0${index + 1}`,
			})),
		};

		await runOpportunityCreditAnalysisResetCore({
			opportunityId: "opportunity-1",
			...resetReservationAdapters(),
			loadAnalysis: async () =>
				analysisExists ? { id: "analysis-1", coverage: oldCoverage } : null,
			loadDocuments: async () => rows,
			persistRecovery: async (_analysisId, value) => {
				persistedCoverage = value;
			},
			quarantineArtifactsAndRefresh: async (artifacts, batchId) => {
				for (const artifact of artifacts) {
					artifact.documentType = "other";
					artifact.description = `[bank-coverage-debt:${batchId}:reset:artifact:${artifact.id}]`;
				}
				checklist.uploaded = false;
			},
			deleteStoredFile: async (key) => {
				blobs.delete(key);
			},
			deleteArtifactAndRefresh: async (artifact) => {
				rows.splice(
					rows.findIndex(({ id }) => id === artifact.id),
					1,
				);
				checklist.uploaded = false;
			},
			deleteAnalysis: async () => {
				analysisExists = false;
			},
		});

		expect(analysisExists).toBe(false);
		expect(rows).toEqual([]);
		expect(blobs.size).toBe(0);
		expect(checklist.uploaded).toBe(false);
		expect(persistedCoverage?.saveStatus).toBe("failed");

		const resolvedThree = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [
				{ indice_archivo: 0, meses: ["2026-01", "2026-02", "2026-03"] },
			],
		});
		const newCoverage: PersistedBankStatementCoverage = {
			...resolvedThree,
			version: 1,
			analysisBatchId: newBatch,
			saveStatus: "pending",
			requestedChecklistAssignments: resolvedThree.checklistAssignments,
			files: [
				{
					...resolvedThree.files[0],
					name: "nuevo.pdf",
					evidenceKey: "bank_statement/opportunity/validated/nuevo.pdf",
					contentSha256: "b".repeat(64),
					integrityValidationId: "55555555-5555-4555-8555-555555555555",
				},
			],
		};
		let nextId = 0;
		const generate = mock(async () => ({ moneda: "GTQ" }));
		const reanalysis = await runInitialBankStatementHandlerCore({
			generateAnalysis: generate,
			prepareAnalysis: async (analysis) => ({
				analysis,
				coverage: newCoverage,
			}),
			persistAnalysis: async () => {
				analysisExists = true;
			},
			validateCurrent: async () => {},
			persistCoverage: async () => {},
			cleanupDebt: async () => [],
			saveArtifacts: (coverageToSave) =>
				runBankStatementArtifactPersistenceCore({
					coverage: coverageToSave,
					loadExistingDocuments: async () => rows,
					readStoredFile: async () => Buffer.from("new"),
					createArtifact: async (artifact) => {
						const id = `new-${++nextId}`;
						const filePath = `opportunities/opportunity-1/${id}.pdf`;
						rows.push({
							id,
							documentType: "other",
							description: `[bank-coverage-debt:${newBatch}:staging:file:0]`,
							filePath,
						});
						blobs.add(filePath);
						return { ...artifact, id, filePath };
					},
					reuseArtifact: async (existing, artifact) => ({
						...artifact,
						id: existing.id,
						filePath: existing.filePath,
					}),
					commitArtifacts: async (artifacts) => {
						for (const artifact of artifacts) {
							const saved = rows.find(({ id }) => id === artifact.id);
							if (!saved) throw new Error("missing row");
							saved.documentType = artifact.documentType;
							saved.description = artifact.description;
						}
						checklist.uploaded = true;
						return artifacts;
					},
					promoteArtifact: async (artifact) => artifact,
					linkArtifacts: async () => {},
					refreshChecklist: async () => {},
					rollbackArtifact: async () => {},
					rollbackReusedArtifact: async () => {},
					quarantineArtifact: async () => {},
					retireArtifact: async () => {},
				}),
		});
		expect(generate).toHaveBeenCalledTimes(1);
		expect(reanalysis.coverage.saveStatus).toBe("saved");
		expect(rows.map(({ documentType }) => documentType)).toEqual([
			"estados_cuenta_1",
			"estados_cuenta_2",
			"estados_cuenta_3",
		]);
		expect(
			rows.every(({ description }) =>
				description?.startsWith(`[bank-coverage:${newBatch}:`),
			),
		).toBe(true);
		expect(rows.some(({ id }) => id.startsWith("old-"))).toBe(false);
		expect(checklist.uploaded).toBe(true);
	});

	test("reset failure preserves exact private debt, quarantines approval, and converges on retry", async () => {
		const batch = "11111111-1111-4111-8111-111111111111";
		const row = {
			id: "old-1",
			documentType: "estados_cuenta_1",
			description: `[bank-coverage:${batch}:type:estados_cuenta_1:file:0:month:2026-01]`,
			filePath: "opportunities/opportunity-1/old-1.pdf",
		};
		const rows = [row];
		let checklistUploaded = true;
		let canApprove = true;
		let failR2 = true;
		let analysisExists = true;
		let activeResetToken: string | null = null;
		let currentCoverage = { ...coverage("saved"), analysisBatchId: batch };
		const execute = () =>
			runOpportunityCreditAnalysisResetCore({
				opportunityId: "opportunity-1",
				reserveReset: async () => {
					if (activeResetToken) throw new Error("reset already active");
					activeResetToken = "reset-token";
					return { analysisId: "analysis-1", token: activeResetToken };
				},
				releaseReset: async ({ token }) => {
					if (activeResetToken === token) activeResetToken = null;
				},
				assertResetCurrent: async ({ token }) => {
					if (activeResetToken !== token) throw new Error("reset token lost");
				},
				loadAnalysis: async () =>
					analysisExists
						? { id: "analysis-1", coverage: currentCoverage }
						: null,
				loadDocuments: async () => rows,
				persistRecovery: async (_analysisId, value) => {
					currentCoverage = value;
				},
				quarantineArtifactsAndRefresh: async (artifacts, batchId) => {
					for (const artifact of artifacts) {
						artifact.documentType = "other";
						artifact.description = `[bank-coverage-debt:${batchId}:reset:artifact:${artifact.id}]`;
					}
					checklistUploaded = false;
					canApprove = false;
				},
				deleteStoredFile: async () => {
					if (failR2) throw new Error("R2 delete failed");
				},
				deleteArtifactAndRefresh: async (artifact) => {
					rows.splice(
						rows.findIndex(({ id }) => id === artifact.id),
						1,
					);
					checklistUploaded = false;
				},
				deleteAnalysis: async () => {
					analysisExists = false;
				},
			});

		await expect(execute()).rejects.toThrow("No se pudieron limpiar");
		expect(analysisExists).toBe(true);
		expect(activeResetToken).toBe(null);
		expect(checklistUploaded).toBe(false);
		expect(canApprove).toBe(false);
		expect(rows[0]).toMatchObject({
			documentType: "other",
			filePath: "opportunities/opportunity-1/old-1.pdf",
		});
		expect(rows[0]?.description).toStartWith(`[bank-coverage-debt:${batch}:`);
		expect(currentCoverage.cleanupDebt).toEqual([
			{
				status: "pending",
				key: row.filePath,
				artifactId: row.id,
			},
		]);

		failR2 = false;
		await execute();
		expect(rows).toEqual([]);
		expect(analysisExists).toBe(false);
		expect(activeResetToken).toBe(null);
		expect(checklistUploaded).toBe(false);
	});

	test("reset preserves manual and other-batch documents", async () => {
		const currentBatch = "11111111-1111-4111-8111-111111111111";
		const rows = [
			{
				id: "current",
				documentType: "estados_cuenta_1",
				description: `[bank-coverage:${currentBatch}:type:estados_cuenta_1:file:0:month:2026-01]`,
				filePath: "opportunities/opportunity-1/current.pdf",
			},
			{
				id: "historical",
				documentType: "other",
				description:
					"[bank-coverage:99999999-9999-4999-8999-999999999999:type:other:file:0:support]",
				filePath: "opportunities/opportunity-1/historical.pdf",
			},
			{
				id: "manual",
				documentType: "estados_cuenta_2",
				description: "Adjunto manual",
				filePath: "opportunities/opportunity-1/manual.pdf",
			},
		];
		await runOpportunityCreditAnalysisResetCore({
			opportunityId: "opportunity-1",
			...resetReservationAdapters(),
			loadAnalysis: async () => ({
				id: "analysis-1",
				coverage: { ...coverage("saved"), analysisBatchId: currentBatch },
			}),
			loadDocuments: async () => rows,
			persistRecovery: async () => {},
			quarantineArtifactsAndRefresh: async (artifacts, batchId) => {
				for (const artifact of artifacts) {
					artifact.documentType = "other";
					artifact.description = `[bank-coverage-debt:${batchId}:reset:artifact:${artifact.id}]`;
				}
			},
			deleteStoredFile: async () => {},
			deleteArtifactAndRefresh: async (artifact) => {
				rows.splice(
					rows.findIndex(({ id }) => id === artifact.id),
					1,
				);
			},
			deleteAnalysis: async () => {},
		});
		expect(rows.map(({ id }) => id)).toEqual(["historical", "manual"]);
	});

	test("reset DB cleanup failure keeps quarantined debt after R2 deletion and retries safely", async () => {
		const batch = "11111111-1111-4111-8111-111111111111";
		const rows = [
			{
				id: "old-1",
				documentType: "estados_cuenta_1",
				description: `[bank-coverage:${batch}:type:estados_cuenta_1:file:0:month:2026-01]`,
				filePath: "opportunities/opportunity-1/old-1.pdf",
			},
		];
		let analysisExists = true;
		let failDb = true;
		let checklistUploaded = true;
		let currentCoverage: PersistedBankStatementCoverage = {
			...coverage("saved"),
			analysisBatchId: batch,
		};
		const execute = () =>
			runOpportunityCreditAnalysisResetCore({
				opportunityId: "opportunity-1",
				...resetReservationAdapters(),
				loadAnalysis: async () =>
					analysisExists
						? { id: "analysis-1", coverage: currentCoverage }
						: null,
				loadDocuments: async () => rows,
				persistRecovery: async (_analysisId, value) => {
					currentCoverage = value;
				},
				quarantineArtifactsAndRefresh: async (artifacts, batchId) => {
					for (const artifact of artifacts) {
						artifact.documentType = "other";
						artifact.description = `[bank-coverage-debt:${batchId}:reset:artifact:${artifact.id}]`;
					}
					checklistUploaded = false;
				},
				deleteStoredFile: async () => {},
				deleteArtifactAndRefresh: async (artifact) => {
					if (failDb) throw new Error("DB delete failed");
					rows.splice(
						rows.findIndex(({ id }) => id === artifact.id),
						1,
					);
				},
				deleteAnalysis: async () => {
					analysisExists = false;
				},
			});

		await expect(execute()).rejects.toThrow("No se pudieron limpiar");
		expect(rows[0]?.documentType).toBe("other");
		expect(checklistUploaded).toBe(false);
		expect(currentCoverage.cleanupDebt?.[0]).toEqual({
			status: "pending",
			key: "opportunities/opportunity-1/old-1.pdf",
			artifactId: "old-1",
		});
		failDb = false;
		await execute();
		expect(rows).toEqual([]);
		expect(analysisExists).toBe(false);
	});

	test("fails closed before persistence for ownership, analysis, batch, or latest integrity drift", async () => {
		for (const reason of [
			"ownership",
			"analysis",
			"batch",
			"latest-non-reset-integrity",
		]) {
			let persisted = false;
			let saved = false;
			await expect(
				runBankStatementCoverageSaveLifecycle({
					coverage: coverage(),
					validateCurrent: async () => {
						throw new Error(reason);
					},
					persistCoverage: async () => {
						persisted = true;
					},
					cleanupDebt: async () => [],
					saveArtifacts: async () => {
						saved = true;
						return {
							documents: [],
							effectiveAssignments: [],
							pendingAssignments: [],
						};
					},
				}),
			).rejects.toThrow(reason);
			expect(persisted).toBe(false);
			expect(saved).toBe(false);
		}
	});
});
