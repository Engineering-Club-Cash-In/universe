import { describe, expect, test } from "bun:test";
import { resolveBankStatementMonthlyCoverage } from "../lib/bank-statement-documents";
import {
	applyManualCoverageDeclaration,
	assertBankStatementCoverageMutation,
	buildBankStatementArtifactPlan,
	saveBankStatementArtifacts,
	toPublicBankStatementCoverage,
} from "./bank-analysis-coverage";

const files = Array.from({ length: 4 }, (_, fileIndex) => ({
	fileIndex,
	name: `estado-${fileIndex + 1}.pdf`,
	evidenceKey: `bank-statements/opportunity/validated/v-${fileIndex}/file.pdf`,
	contentSha256: `${fileIndex}`.repeat(64),
	integrityValidationId: `validation-${fileIndex}`,
}));

const resolvedCoverage = resolveBankStatementMonthlyCoverage({
	uploadedFileCount: files.length,
	coverageByFile: [
		{ indice_archivo: 0, meses: ["2026-01"] },
		{ indice_archivo: 1, meses: ["2026-02"] },
		{ indice_archivo: 2, meses: ["2026-01"] },
		{ indice_archivo: 3, meses: ["2026-03"] },
	],
});

describe("bank analysis coverage save lifecycle", () => {
	test("plans checklist slots from actual month sources and preserves every accepted file", () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [],
		});

		expect(
			plan
				.filter((artifact) => artifact.documentType !== "other")
				.map(({ documentType, fileIndex, month }) => ({
					documentType,
					fileIndex,
					month,
				})),
		).toEqual([
			{ documentType: "estados_cuenta_1", fileIndex: 0, month: "2026-01" },
			{ documentType: "estados_cuenta_2", fileIndex: 1, month: "2026-02" },
			{ documentType: "estados_cuenta_3", fileIndex: 3, month: "2026-03" },
		]);
		expect(new Set(plan.map(({ fileIndex }) => fileIndex))).toEqual(
			new Set([0, 1, 2, 3]),
		);
	});

	test("does not overwrite manual adjuntos or checklist documents from another analysis", () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [
				{
					id: "manual-document",
					documentType: "estados_cuenta_1",
					description: "Adjunto manual",
					filePath: "opportunities/opportunity/manual.pdf",
				},
			],
		});

		expect(
			plan.some((artifact) => artifact.documentType === "estados_cuenta_1"),
		).toBe(false);
		expect(
			plan.some(
				(artifact) =>
					artifact.fileIndex === 0 &&
					artifact.documentType === "estados_cuenta_2",
			),
		).toBe(true);
	});

	test("rolls back only artifacts from the failed attempt and restores checklist from source of truth", async () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [],
		});
		const created: string[] = [];
		const rolledBack: string[] = [];
		let refreshes = 0;

		await expect(
			saveBankStatementArtifacts({
				artifacts: plan,
				existingArtifacts: [],
				createArtifact: async (artifact) => {
					if (created.length === 2) throw new Error("R2 unavailable");
					const saved = {
						...artifact,
						id: `new-${created.length}`,
						filePath: `opportunities/opportunity/new-${created.length}.pdf`,
					};
					created.push(saved.id);
					return saved;
				},
				linkArtifacts: async () => {},
				refreshChecklist: async () => {
					refreshes++;
				},
				rollbackArtifact: async (artifact) => {
					rolledBack.push(artifact.id);
				},
			}),
		).rejects.toThrow("R2 unavailable");
		expect(rolledBack).toEqual(created);
		expect(refreshes).toBe(1);
	});

	test("a validation-link failure rolls back every new document before rebuilding checklist", async () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [],
		});
		const rolledBack: string[] = [];
		let refreshes = 0;

		await expect(
			saveBankStatementArtifacts({
				artifacts: plan,
				existingArtifacts: [],
				createArtifact: async (artifact) => ({
					...artifact,
					id: `new-${artifact.tag}`,
					filePath: `opportunities/opportunity/${artifact.fileIndex}.pdf`,
				}),
				linkArtifacts: async () => {
					throw new Error("validation link failed");
				},
				refreshChecklist: async () => {
					refreshes++;
				},
				rollbackArtifact: async (artifact) => {
					rolledBack.push(artifact.id);
				},
			}),
		).rejects.toThrow("validation link failed");
		expect(rolledBack).toHaveLength(plan.length);
		expect(refreshes).toBe(1);
	});

	test("retry is idempotent and has no AI dependency", async () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [],
		});
		const existingArtifacts = plan.map((artifact, index) => ({
			...artifact,
			id: `existing-${index}`,
			filePath: `opportunities/opportunity/existing-${index}.pdf`,
		}));
		let creates = 0;
		let links = 0;

		const saved = await saveBankStatementArtifacts({
			artifacts: plan,
			existingArtifacts,
			createArtifact: async () => {
				creates++;
				throw new Error("must not create duplicates");
			},
			linkArtifacts: async (artifacts) => {
				links += artifacts.length;
			},
			refreshChecklist: async () => {},
			rollbackArtifact: async () => {},
		});

		expect(saved).toHaveLength(plan.length);
		expect(creates).toBe(0);
		expect(links).toBe(plan.length);
	});

	test("fails closed on permission, opportunity, analysis batch, or integrity drift", () => {
		const valid = {
			requestedOpportunityId: "opportunity-1",
			requestedAnalysisId: "analysis-1",
			requestedLeadId: "lead-1",
			currentOpportunityId: "opportunity-1",
			currentAnalysisId: "analysis-1",
			currentLeadId: "lead-1",
			requestedAnalysisBatchId: "batch-1",
			currentAnalysisBatchId: "batch-1",
			canWrite: true,
			integrityBatchCurrent: true,
		};
		expect(() => assertBankStatementCoverageMutation(valid)).not.toThrow();
		for (const invalid of [
			{ ...valid, canWrite: false },
			{ ...valid, currentOpportunityId: "opportunity-2" },
			{ ...valid, currentAnalysisId: "analysis-2" },
			{ ...valid, currentLeadId: "lead-2" },
			{ ...valid, currentAnalysisBatchId: "batch-2" },
			{ ...valid, integrityBatchCurrent: false },
		]) {
			expect(() => assertBankStatementCoverageMutation(invalid)).toThrow();
		}
	});

	test("public coverage responses omit retry-only evidence", () => {
		const publicCoverage = toPublicBankStatementCoverage({
			...resolvedCoverage,
			version: 1,
			analysisBatchId: "analysis-1",
			saveStatus: "saved",
			files: resolvedCoverage.files.map((file) => ({
				...file,
				...files[file.fileIndex],
			})),
		});

		expect(publicCoverage.files[0]).not.toHaveProperty("evidenceKey");
		expect(publicCoverage.files[0]).not.toHaveProperty("contentSha256");
		expect(publicCoverage.files[0]).not.toHaveProperty("integrityValidationId");
		expect(publicCoverage.files[0].name).toBe("estado-1.pdf");
	});

	test("moves desired months onto available checklist slots and leaves overflow explicitly pending", () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [
				{
					id: "manual-document",
					documentType: "estados_cuenta_1",
					description: "Adjunto manual",
					filePath: "opportunities/opportunity/manual.pdf",
				},
			],
		});

		expect(
			plan
				.filter((artifact) => artifact.documentType !== "other")
				.map(({ documentType, month }) => ({ documentType, month })),
		).toEqual([
			{ documentType: "estados_cuenta_2", month: "2026-01" },
			{ documentType: "estados_cuenta_3", month: "2026-02" },
		]);
	});

	test("reuses an obsolete same-batch support artifact during confirmation", async () => {
		const ambiguous = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [{ indice_archivo: 0, meses: ["Junio"] }],
		});
		const supportPlan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: [files[0]],
			coverage: ambiguous,
			existingDocuments: [],
		});
		const confirmed = applyManualCoverageDeclaration({
			coverage: ambiguous,
			fileIndex: 0,
			months: ["2026-06", "2026-07", "2026-08"],
			actorId: "user-1",
			declaredAt: "2026-09-17T16:00:00.000Z",
		});
		const confirmedPlan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: [files[0]],
			coverage: confirmed,
			existingDocuments: [],
		});
		const created: string[] = [];
		const retired: string[] = [];
		const reused: string[] = [];

		await saveBankStatementArtifacts({
			artifacts: confirmedPlan,
			existingArtifacts: [
				{
					...supportPlan[0],
					id: "support-row",
					filePath: "opportunities/opportunity/support.pdf",
				},
			],
			createArtifact: async (artifact) => {
				created.push(artifact.tag);
				return {
					...artifact,
					id: `new-${created.length}`,
					filePath: `opportunities/opportunity/new-${created.length}.pdf`,
				};
			},
			reuseArtifact: async (existing, artifact) => {
				reused.push(existing.id);
				return { ...artifact, id: existing.id, filePath: existing.filePath };
			},
			retireArtifact: async (artifact) => {
				retired.push(artifact.id);
			},
			linkArtifacts: async () => {},
			refreshChecklist: async () => {},
			rollbackArtifact: async () => {},
		});

		expect(reused).toEqual(["support-row"]);
		expect(created).toHaveLength(2);
		expect(retired).toEqual([]);
	});

	test("retires only unused artifacts supplied from the exact current batch", async () => {
		const confirmed = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [{ indice_archivo: 0, meses: ["2026-06"] }],
		});
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: [files[0]],
			coverage: confirmed,
			existingDocuments: [],
		});
		const retired: string[] = [];
		let refreshes = 0;
		await saveBankStatementArtifacts({
			artifacts: plan,
			existingArtifacts: [
				{
					...plan[0],
					id: "exact-current",
					filePath: "opportunities/opportunity/exact.pdf",
				},
				{
					...plan[0],
					tag: "[bank-coverage:analysis-1:file:0:support]",
					id: "obsolete-current",
					filePath: "opportunities/opportunity/obsolete.pdf",
				},
			],
			createArtifact: async () => {
				throw new Error("must discover exact artifact");
			},
			linkArtifacts: async () => {},
			refreshChecklist: async () => {
				refreshes++;
			},
			rollbackArtifact: async () => {},
			retireArtifact: async (artifact) => {
				retired.push(artifact.id);
			},
		});
		expect(retired).toEqual(["obsolete-current"]);
		expect(refreshes).toBe(2);
	});

	test("retains the uploaded key when DB insert fails and R2 cleanup rejects", async () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: [files[0]],
			coverage: resolveBankStatementMonthlyCoverage({
				uploadedFileCount: 1,
				coverageByFile: [{ indice_archivo: 0, meses: ["2026-01"] }],
			}),
			existingDocuments: [],
		});
		let caught: unknown;
		try {
			await saveBankStatementArtifacts({
				artifacts: plan,
				existingArtifacts: [],
				createArtifact: async () => {
					throw Object.assign(new Error("DB insert failed"), {
						cleanupDebt: [
							{
								status: "pending" as const,
								key: "opportunities/opportunity/upload-without-row.pdf",
							},
						],
					});
				},
				linkArtifacts: async () => {},
				refreshChecklist: async () => {},
				rollbackArtifact: async () => {},
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toHaveProperty("cleanupDebt", [
			{
				status: "pending",
				key: "opportunities/opportunity/upload-without-row.pdf",
			},
		]);
	});

	test("reports durable cleanup debt when rollback cannot delete a current-attempt artifact", async () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: [files[0]],
			coverage: resolveBankStatementMonthlyCoverage({
				uploadedFileCount: 1,
				coverageByFile: [{ indice_archivo: 0, meses: ["2026-01"] }],
			}),
			existingDocuments: [],
		});
		let caught: unknown;
		try {
			await saveBankStatementArtifacts({
				artifacts: plan,
				existingArtifacts: [],
				createArtifact: async (artifact) => ({
					...artifact,
					id: "new-1",
					filePath: "opportunities/opportunity/new-1.pdf",
				}),
				linkArtifacts: async () => {
					throw new Error("link failed");
				},
				refreshChecklist: async () => {},
				rollbackArtifact: async () => {
					throw new Error("R2 delete failed");
				},
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toHaveProperty("cleanupDebt", [
			{
				status: "pending",
				key: "opportunities/opportunity/new-1.pdf",
				artifactId: "new-1",
			},
		]);
	});

	test("quarantines rollback debt before checklist refresh so a failed row cannot satisfy approval", async () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: [files[0]],
			coverage: resolveBankStatementMonthlyCoverage({
				uploadedFileCount: 1,
				coverageByFile: [{ indice_archivo: 0, meses: ["2026-01"] }],
			}),
			existingDocuments: [],
		});
		const row = {
			documentType: plan[0].documentType,
			description: plan[0].description,
		};
		let checklistUploaded = false;
		let caught: unknown;
		try {
			await saveBankStatementArtifacts({
				artifacts: plan,
				existingArtifacts: [],
				createArtifact: async (artifact) => ({
					...artifact,
					id: "debt-row",
					filePath: "opportunities/opportunity/debt.pdf",
				}),
				linkArtifacts: async () => {
					throw new Error("link failed");
				},
				refreshChecklist: async () => {
					checklistUploaded = row.documentType === "estados_cuenta_1";
				},
				rollbackArtifact: async () => {
					throw new Error("R2 delete failed");
				},
				quarantineArtifact: async (_artifact, cleanupTag) => {
					row.documentType = "other";
					row.description = cleanupTag;
				},
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toHaveProperty("cleanupDebt");
		expect(row.documentType).toBe("other");
		expect(row.description).toStartWith("[bank-coverage-debt:analysis-1:");
		expect(checklistUploaded).toBe(false);
	});

	test("artifact tags encode the actual checklist document type", () => {
		const plan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files,
			coverage: resolvedCoverage,
			existingDocuments: [
				{
					id: "manual-document",
					documentType: "estados_cuenta_1",
					description: "Adjunto manual",
					filePath: "opportunities/opportunity/manual.pdf",
				},
			],
		});
		expect(plan[0].documentType).toBe("estados_cuenta_2");
		expect(plan[0].tag).toContain("type:estados_cuenta_2");
		expect(plan[0].tag).not.toContain("slot:0");
	});

	test("reconciles document types when a foreign first slot is freed", async () => {
		const threeFiles = files.slice(0, 3);
		const coverage = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 3,
			coverageByFile: [
				{ indice_archivo: 0, meses: ["2026-01"] },
				{ indice_archivo: 1, meses: ["2026-02"] },
				{ indice_archivo: 2, meses: ["2026-03"] },
			],
		});
		const foreign = {
			id: "manual-slot-1",
			documentType: "estados_cuenta_1",
			description: "Adjunto manual",
			filePath: "opportunities/opportunity/manual.pdf",
		};
		const occupiedPlan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: threeFiles,
			coverage,
			existingDocuments: [foreign],
		});
		const existingArtifacts = occupiedPlan.map((artifact, index) => ({
			...artifact,
			id: `existing-${index}`,
			filePath: `opportunities/opportunity/existing-${index}.pdf`,
		}));
		const freedPlan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: threeFiles,
			coverage,
			existingDocuments: existingArtifacts,
		});
		const storedTypes = new Map(
			existingArtifacts.map((artifact) => [artifact.id, artifact.documentType]),
		);
		const saved = await saveBankStatementArtifacts({
			artifacts: freedPlan,
			existingArtifacts,
			createArtifact: async (artifact) => ({
				...artifact,
				id: `new-${artifact.fileIndex}`,
				filePath: `opportunities/opportunity/new-${artifact.fileIndex}.pdf`,
			}),
			reuseArtifact: async (existing, planned) => {
				storedTypes.set(existing.id, planned.documentType);
				return { ...planned, id: existing.id, filePath: existing.filePath };
			},
			linkArtifacts: async () => {},
			refreshChecklist: async () => {},
			rollbackArtifact: async () => {},
		});

		expect(saved.map(({ documentType }) => documentType)).toEqual([
			"estados_cuenta_1",
			"estados_cuenta_2",
			"estados_cuenta_3",
		]);
		expect(new Set(saved.map(({ documentType }) => documentType)).size).toBe(3);
		expect([...storedTypes.values()].sort()).toEqual([
			"estados_cuenta_1",
			"estados_cuenta_2",
			"estados_cuenta_3",
		]);
	});

	test("keeps inverse occupancy changes pending without duplicate checklist types", async () => {
		const threeFiles = files.slice(0, 3);
		const coverage = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 3,
			coverageByFile: [
				{ indice_archivo: 0, meses: ["2026-01"] },
				{ indice_archivo: 1, meses: ["2026-02"] },
				{ indice_archivo: 2, meses: ["2026-03"] },
			],
		});
		const initialPlan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: threeFiles,
			coverage,
			existingDocuments: [],
		});
		const existingArtifacts = initialPlan.map((artifact, index) => ({
			...artifact,
			id: `existing-${index}`,
			filePath: `opportunities/opportunity/existing-${index}.pdf`,
		}));
		const changedPlan = buildBankStatementArtifactPlan({
			analysisBatchId: "analysis-1",
			files: threeFiles,
			coverage,
			existingDocuments: [
				...existingArtifacts,
				{
					id: "manual-slot-1",
					documentType: "estados_cuenta_1",
					description: "Adjunto manual",
					filePath: "opportunities/opportunity/manual.pdf",
				},
			],
		});
		const saved = await saveBankStatementArtifacts({
			artifacts: changedPlan,
			existingArtifacts,
			createArtifact: async (artifact) => ({
				...artifact,
				id: `new-${artifact.fileIndex}`,
				filePath: `opportunities/opportunity/new-${artifact.fileIndex}.pdf`,
			}),
			reuseArtifact: async (existing, planned) => ({
				...planned,
				id: existing.id,
				filePath: existing.filePath,
			}),
			linkArtifacts: async () => {},
			refreshChecklist: async () => {},
			rollbackArtifact: async () => {},
		});
		const checklistTypes = saved
			.map(({ documentType }) => documentType)
			.filter((type) => type !== "other");
		expect(checklistTypes).toEqual(["estados_cuenta_2", "estados_cuenta_3"]);
		expect(new Set(checklistTypes).size).toBe(checklistTypes.length);
		expect(changedPlan.some(({ documentType }) => documentType === "other")).toBe(
			true,
		);
	});

	test("records a manual declaration separately without changing detected months or integrity", () => {
		const ambiguous = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [{ indice_archivo: 0, meses: ["Junio"] }],
		});
		const integrity = { result: "observacion", validationId: "validation-1" };
		const confirmed = applyManualCoverageDeclaration({
			coverage: ambiguous,
			fileIndex: 0,
			months: ["2026-06"],
			actorId: "user-1",
			declaredAt: "2026-09-17T16:00:00.000Z",
		});

		expect(confirmed.status).toBe("detected");
		expect(confirmed.files[0].detectedMonths).toEqual(["Junio"]);
		expect(confirmed.manualDeclarations).toEqual([
			{
				fileIndex: 0,
				months: ["2026-06"],
				detectedMonths: ["Junio"],
				actorId: "user-1",
				declaredAt: "2026-09-17T16:00:00.000Z",
			},
		]);
		expect(integrity).toEqual({
			result: "observacion",
			validationId: "validation-1",
		});
	});
});
