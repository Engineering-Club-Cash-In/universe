export const BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES = [
	"estados_cuenta_1",
	"estados_cuenta_2",
	"estados_cuenta_3",
] as const;

export type BankStatementOpportunityDocumentType =
	(typeof BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES)[number];

export interface BankStatementCoverageByFile {
	indice_archivo: number;
	meses: string[];
}

export interface BankStatementManualDeclaration {
	fileIndex: number;
	months: string[];
	detectedMonths: string[];
	actorId: string;
	declaredAt: string;
}

export interface ResolvedBankStatementCoverage {
	status: "detected" | "needs_confirmation";
	months: Array<{ month: string; sourceFileIndexes: number[] }>;
	files: Array<{
		fileIndex: number;
		status: "detected" | "confirmed" | "needs_confirmation";
		detectedMonths: string[];
		effectiveMonths: string[];
	}>;
	checklistAssignments: Array<{
		month: string;
		fileIndex: number;
		sourceFileIndexes: number[];
	}>;
	manualDeclarations: BankStatementManualDeclaration[];
	reportedCoverage: BankStatementCoverageByFile[];
	issues: string[];
}

const CANONICAL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCanonicalBankStatementMonth(value: string): boolean {
	return CANONICAL_MONTH.test(value);
}

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

export function getBankStatementOpportunityDocumentType(
	index: number,
): BankStatementOpportunityDocumentType | undefined {
	return BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES[index];
}

export function resolveBankStatementMonthlyCoverage({
	uploadedFileCount,
	coverageByFile,
	manualDeclarations = [],
}: {
	uploadedFileCount: number;
	coverageByFile?: BankStatementCoverageByFile[];
	manualDeclarations?: BankStatementManualDeclaration[];
}): ResolvedBankStatementCoverage {
	const fileCount = Math.max(0, Math.min(9, uploadedFileCount));
	const reportedCoverage = (coverageByFile ?? []).map((entry) => ({
		indice_archivo: entry.indice_archivo,
		meses: [...entry.meses],
	}));
	const issues: string[] = [];
	const invalidProvenanceIssues: string[] = [];
	const entriesByFile = new Map<number, BankStatementCoverageByFile[]>();

	for (const entry of reportedCoverage) {
		if (
			!Number.isInteger(entry.indice_archivo) ||
			entry.indice_archivo < 0 ||
			entry.indice_archivo >= fileCount
		) {
			invalidProvenanceIssues.push(
				`Índice de archivo fuera de rango: ${entry.indice_archivo}`,
			);
			continue;
		}
		const entries = entriesByFile.get(entry.indice_archivo) ?? [];
		entries.push(entry);
		entriesByFile.set(entry.indice_archivo, entries);
	}

	const latestDeclarationByFile = new Map<
		number,
		BankStatementManualDeclaration
	>();
	for (const declaration of manualDeclarations) {
		if (
			Number.isInteger(declaration.fileIndex) &&
			declaration.fileIndex >= 0 &&
			declaration.fileIndex < fileCount &&
			declaration.months.length > 0 &&
			declaration.months.every(isCanonicalBankStatementMonth)
		) {
			latestDeclarationByFile.set(declaration.fileIndex, declaration);
		} else {
			issues.push(
				`Declaración manual inválida para archivo ${declaration.fileIndex}`,
			);
		}
	}

	const allFilesManuallyDeclared =
		fileCount > 0 &&
		Array.from({ length: fileCount }, (_, fileIndex) => fileIndex).every(
			(fileIndex) => latestDeclarationByFile.has(fileIndex),
		);
	const requiresGlobalConfirmation =
		invalidProvenanceIssues.length > 0 && !allFilesManuallyDeclared;
	if (requiresGlobalConfirmation) issues.push(...invalidProvenanceIssues);

	const files: ResolvedBankStatementCoverage["files"] = [];
	for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
		const entries = entriesByFile.get(fileIndex) ?? [];
		const detectedMonths = uniqueSorted(
			entries.flatMap((entry) => entry.meses),
		);
		const declaration = latestDeclarationByFile.get(fileIndex);
		if (declaration) {
			files.push({
				fileIndex,
				status: "confirmed",
				detectedMonths,
				effectiveMonths: uniqueSorted(declaration.months),
			});
			continue;
		}

		if (requiresGlobalConfirmation) {
			files.push({
				fileIndex,
				status: "needs_confirmation",
				detectedMonths,
				effectiveMonths: [],
			});
			issues.push(`Cobertura no confirmada para archivo ${fileIndex}`);
			continue;
		}

		const normalizedSets = entries.map((entry) => uniqueSorted(entry.meses));
		const valid = normalizedSets.every(
			(months) =>
				months.length > 0 && months.every(isCanonicalBankStatementMonth),
		);
		const firstSet = normalizedSets[0]?.join("|");
		const contradictory = normalizedSets.some(
			(months) => months.join("|") !== firstSet,
		);
		if (!valid || entries.length === 0 || contradictory) {
			files.push({
				fileIndex,
				status: "needs_confirmation",
				detectedMonths,
				effectiveMonths: [],
			});
			issues.push(`Cobertura no confirmada para archivo ${fileIndex}`);
			continue;
		}

		files.push({
			fileIndex,
			status: "detected",
			detectedMonths,
			effectiveMonths: normalizedSets[0],
		});
	}

	const sourcesByMonth = new Map<string, Set<number>>();
	for (const file of files) {
		for (const month of file.effectiveMonths) {
			const sources = sourcesByMonth.get(month) ?? new Set<number>();
			sources.add(file.fileIndex);
			sourcesByMonth.set(month, sources);
		}
	}
	const months = [...sourcesByMonth]
		.map(([month, sourceFileIndexes]) => ({
			month,
			sourceFileIndexes: [...sourceFileIndexes].sort((a, b) => a - b),
		}))
		.sort((a, b) => a.month.localeCompare(b.month));
	const status =
		fileCount > 0 &&
		issues.length === 0 &&
		files.every((file) => file.status !== "needs_confirmation")
			? "detected"
			: "needs_confirmation";

	return {
		status,
		months,
		files,
		checklistAssignments:
			status === "detected"
				? months
						.slice(0, BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES.length)
						.map((month) => ({
							...month,
							fileIndex: month.sourceFileIndexes[0],
						}))
				: [],
		manualDeclarations: [...manualDeclarations],
		reportedCoverage,
		issues,
	};
}

export function isReservedBankCoverageDescription(
	description: string | null | undefined,
): boolean {
	return (
		description?.startsWith("[bank-coverage:") === true ||
		description?.startsWith("[bank-coverage-debt:") === true
	);
}

const PRIVATE_COVERAGE_KEYS = new Set([
	"evidenceKey",
	"contentSha256",
	"integrityValidationId",
	"cleanupDebt",
]);

function redactPrivateCoverageFields(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactPrivateCoverageFields);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !PRIVATE_COVERAGE_KEYS.has(key))
			.map(([key, child]) => [key, redactPrivateCoverageFields(child)]),
	);
}

export function redactBankStatementCoverageEvidence(
	fullAnalysis: string | null,
): string | null {
	if (!fullAnalysis) return fullAnalysis;
	try {
		const parsed: unknown = JSON.parse(fullAnalysis);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return null;
		const analysis = parsed as Record<string, unknown>;
		if (!("cobertura_mensual" in analysis)) return fullAnalysis;
		const coverage = analysis.cobertura_mensual;
		if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
			return JSON.stringify({ ...analysis, cobertura_mensual: null });
		}
		const files = (coverage as Record<string, unknown>).files;
		if (
			!Array.isArray(files) ||
			!files.every(
				(file: unknown) =>
					!!file && typeof file === "object" && !Array.isArray(file),
			)
		) {
			return JSON.stringify({ ...analysis, cobertura_mensual: null });
		}
		return JSON.stringify({
			...analysis,
			cobertura_mensual: redactPrivateCoverageFields(coverage),
		});
	} catch {
		return null;
	}
}

export function canAutoAttachBankStatementDocuments({
	userRole,
	userId,
	opportunityAssignedTo,
}: {
	userRole: string;
	userId: string;
	opportunityAssignedTo: string | null;
}) {
	if (!["admin", "sales", "sales_supervisor", "analyst"].includes(userRole)) {
		return false;
	}

	return userRole !== "sales" || opportunityAssignedTo === userId;
}
