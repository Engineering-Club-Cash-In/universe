import { describe, expect, test } from "bun:test";
import {
	canAutoAttachBankStatementDocuments,
	getBankStatementOpportunityDocumentType,
	isReservedBankCoverageDescription,
	redactBankStatementCoverageEvidence,
	resolveBankStatementMonthlyCoverage,
} from "./bank-statement-documents";

const coverage = (
	uploadedFileCount: number,
	coverageByFile: Array<{ indice_archivo: number; meses: string[] }>,
) => resolveBankStatementMonthlyCoverage({ uploadedFileCount, coverageByFile });

describe("bank statement monthly coverage", () => {
	test("maps at most three checklist document types", () => {
		expect(getBankStatementOpportunityDocumentType(0)).toBe("estados_cuenta_1");
		expect(getBankStatementOpportunityDocumentType(1)).toBe("estados_cuenta_2");
		expect(getBankStatementOpportunityDocumentType(2)).toBe("estados_cuenta_3");
		expect(getBankStatementOpportunityDocumentType(3)).toBeUndefined();
	});

	test("one PDF can support three unique canonical months", () => {
		const result = coverage(1, [
			{ indice_archivo: 0, meses: ["2026-06", "2026-07", "2026-08"] },
		]);

		expect(result.status).toBe("detected");
		expect(result.months).toEqual([
			{ month: "2026-06", sourceFileIndexes: [0] },
			{ month: "2026-07", sourceFileIndexes: [0] },
			{ month: "2026-08", sourceFileIndexes: [0] },
		]);
		expect(
			result.checklistAssignments.map(({ fileIndex }) => fileIndex),
		).toEqual([0, 0, 0]);
	});

	test("one PDF with three monthly summaries fills three slots when model omits provenance", () => {
		const result = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			monthlySummaryMonths: ["Junio 2026", "Julio 2026", "Agosto 2026"],
		});

		expect(result.status).toBe("detected");
		expect(result.checklistAssignments).toMatchObject([
			{ month: "2026-06", fileIndex: 0 },
			{ month: "2026-07", fileIndex: 0 },
			{ month: "2026-08", fileIndex: 0 },
		]);
	});

	test("never invents month-to-file provenance from ambiguous summaries", () => {
		for (const input of [
			{
				uploadedFileCount: 2,
				monthlySummaryMonths: ["Junio 2026", "Julio 2026"],
			},
			{
				uploadedFileCount: 1,
				monthlySummaryMonths: ["Junio 2026", "Junio 2026"],
			},
			{ uploadedFileCount: 1, monthlySummaryMonths: ["Junio", "Julio 2026"] },
		]) {
			const result = resolveBankStatementMonthlyCoverage(input);
			expect(result.status).toBe("needs_confirmation");
			expect(result.checklistAssignments).toEqual([]);
		}
	});

	test("one PDF with a partial model coverage uses the other distinct monthly summaries", () => {
		const result = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [{ indice_archivo: 0, meses: ["2026-06"] }],
			monthlySummaryMonths: ["Junio 2026", "Julio 2026", "Agosto 2026"],
		});
		expect(result.checklistAssignments.map(({ month }) => month)).toEqual([
			"2026-06",
			"2026-07",
			"2026-08",
		]);
		expect(result.reportedCoverage).toEqual([
			{ indice_archivo: 0, meses: ["2026-06"] },
		]);
	});

	test("an explicitly empty month list still requires confirmation", () => {
		const result = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [{ indice_archivo: 0, meses: [] }],
			monthlySummaryMonths: ["Junio 2026", "Julio 2026", "Agosto 2026"],
		});
		expect(result.status).toBe("needs_confirmation");
		expect(result.checklistAssignments).toEqual([]);
	});

	test("contradictory per-file provenance requires confirmation", () => {
		const result = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 1,
			coverageByFile: [{ indice_archivo: 0, meses: ["2026-05"] }],
			monthlySummaryMonths: ["Junio 2026", "Julio 2026", "Agosto 2026"],
		});
		expect(result.status).toBe("needs_confirmation");
		expect(result.checklistAssignments).toEqual([]);
	});

	test("three PDFs preserve one actual source per distinct month", () => {
		const result = coverage(3, [
			{ indice_archivo: 0, meses: ["2026-06"] },
			{ indice_archivo: 1, meses: ["2026-07"] },
			{ indice_archivo: 2, meses: ["2026-08"] },
		]);

		expect(result.checklistAssignments).toMatchObject([
			{ month: "2026-06", fileIndex: 0, sourceFileIndexes: [0] },
			{ month: "2026-07", fileIndex: 1, sourceFileIndexes: [1] },
			{ month: "2026-08", fileIndex: 2, sourceFileIndexes: [2] },
		]);
	});

	test("uses provenance rather than upload position for a reordered 2+1 batch", () => {
		const result = coverage(2, [
			{ indice_archivo: 1, meses: ["2026-06", "2026-07"] },
			{ indice_archivo: 0, meses: ["2026-08"] },
		]);

		expect(
			result.checklistAssignments.map(({ month, fileIndex }) => ({
				month,
				fileIndex,
			})),
		).toEqual([
			{ month: "2026-06", fileIndex: 1 },
			{ month: "2026-07", fileIndex: 1 },
			{ month: "2026-08", fileIndex: 0 },
		]);
	});

	test("deduplicates the same month across files while preserving every source", () => {
		const result = coverage(3, [
			{ indice_archivo: 0, meses: ["2026-06", "2026-06"] },
			{ indice_archivo: 1, meses: ["2026-06"] },
			{ indice_archivo: 2, meses: ["2026-06"] },
		]);

		expect(result.months).toEqual([
			{ month: "2026-06", sourceFileIndexes: [0, 1, 2] },
		]);
		expect(result.checklistAssignments).toHaveLength(1);
	});

	test("two accounts in separate files for one month preserve both supporting files", () => {
		const result = coverage(2, [
			{ indice_archivo: 0, meses: ["2026-05"] },
			{ indice_archivo: 1, meses: ["2026-05"] },
		]);

		expect(result.months[0]).toEqual({
			month: "2026-05",
			sourceFileIndexes: [0, 1],
		});
		expect(result.files.map((file) => file.fileIndex)).toEqual([0, 1]);
	});

	test("keeps December/January and the same month in different years distinct", () => {
		const result = coverage(2, [
			{ indice_archivo: 0, meses: ["2025-12", "2026-01"] },
			{ indice_archivo: 1, meses: ["2025-01"] },
		]);

		expect(result.months.map(({ month }) => month)).toEqual([
			"2025-01",
			"2025-12",
			"2026-01",
		]);
	});

	test("fails closed for absent, contradictory, noncanonical, or out-of-range provenance", () => {
		for (const result of [
			coverage(1, []),
			coverage(1, [
				{ indice_archivo: 0, meses: ["2026-06"] },
				{ indice_archivo: 0, meses: ["2026-07"] },
			]),
			coverage(1, [{ indice_archivo: 0, meses: ["Junio 2026"] }]),
			coverage(1, [{ indice_archivo: 0, meses: ["Junio"] }]),
			coverage(1, [{ indice_archivo: 0, meses: ["ilegible"] }]),
			coverage(1, [{ indice_archivo: 1, meses: ["2026-06"] }]),
		]) {
			expect(result.status).toBe("needs_confirmation");
			expect(result.checklistAssignments).toEqual([]);
		}
	});

	test("global invalid provenance makes every real detected file confirmable", () => {
		const reportedCoverage = [
			{ indice_archivo: 0, meses: ["2026-01"] },
			{ indice_archivo: 1, meses: ["2026-02"] },
			{ indice_archivo: 2, meses: ["2026-03"] },
		];
		const result = coverage(2, reportedCoverage);

		expect(result.status).toBe("needs_confirmation");
		expect(result.files).toMatchObject([
			{ fileIndex: 0, status: "needs_confirmation" },
			{ fileIndex: 1, status: "needs_confirmation" },
		]);
		expect(result.checklistAssignments).toEqual([]);
		expect(result.reportedCoverage).toEqual(reportedCoverage);
		expect(result.issues).toContain("Índice de archivo fuera de rango: 2");
	});

	test("manual confirmation of every real file supersedes invalid model provenance", () => {
		const reportedCoverage = [
			{ indice_archivo: 0, meses: ["2026-01"] },
			{ indice_archivo: 1, meses: ["2026-02"] },
			{ indice_archivo: 2, meses: ["2026-03"] },
		];
		const result = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 2,
			coverageByFile: reportedCoverage,
			manualDeclarations: [
				{
					fileIndex: 0,
					months: ["2026-01"],
					detectedMonths: ["2026-01"],
					actorId: "user-1",
					declaredAt: "2026-09-17T12:00:00.000Z",
				},
				{
					fileIndex: 1,
					months: ["2026-02"],
					detectedMonths: ["2026-02"],
					actorId: "user-1",
					declaredAt: "2026-09-17T12:01:00.000Z",
				},
			],
		});

		expect(result.status).toBe("detected");
		expect(result.files.map(({ status }) => status)).toEqual([
			"confirmed",
			"confirmed",
		]);
		expect(result.checklistAssignments).toMatchObject([
			{ month: "2026-01", fileIndex: 0 },
			{ month: "2026-02", fileIndex: 1 },
		]);
		expect(result.issues).toEqual([]);
		expect(result.reportedCoverage).toEqual(reportedCoverage);
	});

	test("partial confirmation keeps global invalid provenance pending", () => {
		const result = resolveBankStatementMonthlyCoverage({
			uploadedFileCount: 2,
			coverageByFile: [
				{ indice_archivo: 0, meses: ["2026-01"] },
				{ indice_archivo: 1, meses: ["2026-02"] },
				{ indice_archivo: 9, meses: ["2026-03"] },
			],
			manualDeclarations: [
				{
					fileIndex: 0,
					months: ["2026-01"],
					detectedMonths: ["2026-01"],
					actorId: "user-1",
					declaredAt: "2026-09-17T12:00:00.000Z",
				},
			],
		});

		expect(result.status).toBe("needs_confirmation");
		expect(result.files).toMatchObject([
			{ fileIndex: 0, status: "confirmed" },
			{ fileIndex: 1, status: "needs_confirmation" },
		]);
		expect(result.checklistAssignments).toEqual([]);
	});

	test("handles zero files without manufacturing coverage", () => {
		const result = coverage(0, []);
		expect(result.status).toBe("needs_confirmation");
		expect(result.months).toEqual([]);
		expect(result.files).toEqual([]);
	});

	test("keeps every detected month but caps checklist requirements at three", () => {
		const result = coverage(1, [
			{
				indice_archivo: 0,
				meses: ["2026-01", "2026-02", "2026-03", "2026-04"],
			},
		]);

		expect(result.months).toHaveLength(4);
		expect(result.checklistAssignments).toHaveLength(3);
	});

	test("considers all nine files and a fourth file can contribute a checklist month", () => {
		const result = coverage(
			9,
			Array.from({ length: 9 }, (_, fileIndex) => ({
				indice_archivo: fileIndex,
				meses:
					fileIndex === 0
						? ["2026-01"]
						: fileIndex === 1
							? ["2026-02"]
							: fileIndex === 3
								? ["2026-03"]
								: ["2026-01"],
			})),
		);

		expect(result.files).toHaveLength(9);
		expect(result.checklistAssignments).toContainEqual({
			month: "2026-03",
			fileIndex: 3,
			sourceFileIndexes: [3],
		});
	});

	test("reserves system artifact descriptions against manual impersonation", () => {
		expect(
			isReservedBankCoverageDescription(
				"[bank-coverage:batch-1:file:0:support] contenido manual",
			),
		).toBe(true);
		expect(
			isReservedBankCoverageDescription(
				"[bank-coverage-debt:batch-1:artifact:1:file:0]",
			),
		).toBe(true);
		expect(isReservedBankCoverageDescription("Adjunto manual")).toBe(false);
	});

	test("redacts retry-only evidence from the client-visible analysis", () => {
		const redacted = redactBankStatementCoverageEvidence(
			JSON.stringify({
				promedio_mensual: { disponibilidad_economica: 100 },
				cobertura_mensual: {
					analysisBatchId: "batch-1",
					files: [
						{
							fileIndex: 0,
							name: "estado.pdf",
							evidenceKey: "bank-statements/private.pdf",
							contentSha256: "a".repeat(64),
							integrityValidationId: "validation-1",
						},
					],
				},
			}),
		);

		expect(redacted).not.toContain("bank-statements/private.pdf");
		expect(redacted).not.toContain("contentSha256");
		expect(redacted).not.toContain("integrityValidationId");
		expect(redacted).toContain("estado.pdf");
		expect(redacted).toContain("disponibilidad_economica");
	});

	test("fails closed when persisted coverage is malformed or cannot be parsed", () => {
		for (const malformed of [
			'{"cobertura_mensual":{"files":',
			JSON.stringify({
				promedio_mensual: { disponibilidad_economica: 100 },
				cobertura_mensual: {
					files: "drifted",
					evidenceKey: "bank-statements/private.pdf",
					contentSha256: "secret-hash",
					integrityValidationId: "secret-validation",
					cleanupDebt: [{ key: "bank-statements/orphan.pdf" }],
				},
			}),
		]) {
			const redacted = String(redactBankStatementCoverageEvidence(malformed));
			expect(redacted).not.toContain("evidenceKey");
			expect(redacted).not.toContain("contentSha256");
			expect(redacted).not.toContain("integrityValidationId");
			expect(redacted).not.toContain("cleanupDebt");
			expect(redacted).not.toContain("private.pdf");
			expect(redacted).not.toContain("orphan.pdf");
		}
	});

	test("allows auto-attachments only for upload roles and assigned sales users", () => {
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "admin",
				userId: "user-1",
				opportunityAssignedTo: "user-2",
			}),
		).toBe(true);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "sales",
				userId: "user-1",
				opportunityAssignedTo: "user-1",
			}),
		).toBe(true);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "sales",
				userId: "user-1",
				opportunityAssignedTo: "user-2",
			}),
		).toBe(false);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "juridico",
				userId: "user-1",
				opportunityAssignedTo: "user-1",
			}),
		).toBe(false);
	});
});
