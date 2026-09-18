import { createHash } from "node:crypto";
import {
	BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES,
	type BankStatementManualDeclaration,
	type BankStatementOpportunityDocumentType,
	isCanonicalBankStatementMonth,
	type ResolvedBankStatementCoverage,
	resolveBankStatementMonthlyCoverage,
} from "../lib/bank-statement-documents";

export type BankStatementCoverageSaveStatus =
	| "pending"
	| "saved"
	| "failed"
	| "not_applicable";

export interface BankStatementCoverageCleanupDebt {
	status: "pending";
	key: string;
	artifactId?: string;
}

type BankStatementChecklistAssignment =
	ResolvedBankStatementCoverage["checklistAssignments"][number] & {
		documentType?: BankStatementOpportunityDocumentType;
	};

export interface BankStatementCoverageFileEvidence {
	fileIndex: number;
	name: string;
	evidenceKey: string;
	contentSha256: string;
	integrityValidationId?: string;
	mimeType?: string;
	size?: number;
}

export interface PersistedBankStatementCoverage
	extends Omit<ResolvedBankStatementCoverage, "files"> {
	version: 1;
	analysisBatchId: string;
	saveStatus: BankStatementCoverageSaveStatus;
	saveError?: string;
	files: Array<
		ResolvedBankStatementCoverage["files"][number] &
			BankStatementCoverageFileEvidence
	>;
	requestedChecklistAssignments?: BankStatementChecklistAssignment[];
	pendingChecklistAssignments?: BankStatementChecklistAssignment[];
	cleanupDebt?: BankStatementCoverageCleanupDebt[];
	savedDocuments?: Array<{
		id: string;
		tag: string;
		fileIndex: number;
		documentType: BankStatementOpportunityDocumentType | "other";
		month?: string;
	}>;
}

export function toPublicBankStatementCoverage(
	coverage: PersistedBankStatementCoverage,
) {
	const { cleanupDebt: _cleanupDebt, ...publicCoverage } = coverage;
	return {
		...publicCoverage,
		files: coverage.files.map(
			({
				evidenceKey: _evidenceKey,
				contentSha256: _contentSha256,
				integrityValidationId: _integrityValidationId,
				...file
			}) => file,
		),
	};
}

export interface ExistingBankStatementDocument {
	id: string;
	documentType: string;
	description: string | null;
	filePath: string;
}

export interface BankStatementArtifact {
	tag: string;
	description: string;
	analysisBatchId: string;
	fileIndex: number;
	file: BankStatementCoverageFileEvidence;
	documentType: BankStatementOpportunityDocumentType | "other";
	month?: string;
}

export interface SavedBankStatementArtifact extends BankStatementArtifact {
	id: string;
	filePath: string;
}

const batchPrefix = (analysisBatchId: string) =>
	`[bank-coverage:${analysisBatchId}:`;

export function getBankStatementArtifactTag(
	description: string | null | undefined,
): string | undefined {
	if (!description?.startsWith("[bank-coverage:")) return undefined;
	const end = description.indexOf("]");
	return end >= 0 ? description.slice(0, end + 1) : undefined;
}

function artifactDescription(tag: string) {
	return `${tag} Guardado automáticamente desde análisis de capacidad de pago`;
}

export function buildBankStatementArtifactPlan({
	analysisBatchId,
	files,
	coverage,
	existingDocuments,
}: {
	analysisBatchId: string;
	files: BankStatementCoverageFileEvidence[];
	coverage: ResolvedBankStatementCoverage;
	existingDocuments: ExistingBankStatementDocument[];
}): BankStatementArtifact[] {
	const ownedPrefix = batchPrefix(analysisBatchId);
	const occupiedByForeign = new Set(
		existingDocuments
			.filter(
				(document) =>
					document.documentType !== "other" &&
					!document.description?.startsWith(ownedPrefix),
			)
			.map((document) => document.documentType),
	);
	const fileByIndex = new Map(files.map((file) => [file.fileIndex, file]));
	const artifacts: BankStatementArtifact[] = [];
	const representedFiles = new Set<number>();
	const availableDocumentTypes =
		BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES.filter(
			(documentType) => !occupiedByForeign.has(documentType),
		);
	const desiredAssignments =
		"requestedChecklistAssignments" in coverage &&
		Array.isArray(coverage.requestedChecklistAssignments)
			? coverage.requestedChecklistAssignments
			: coverage.checklistAssignments;

	for (const [slot, assignment] of desiredAssignments.entries()) {
		const documentType = availableDocumentTypes[slot];
		const file = fileByIndex.get(assignment.fileIndex);
		if (!documentType || !file) continue;
		const tag = `[bank-coverage:${analysisBatchId}:type:${documentType}:file:${file.fileIndex}:month:${assignment.month}]`;
		artifacts.push({
			tag,
			description: artifactDescription(tag),
			analysisBatchId,
			fileIndex: file.fileIndex,
			file,
			documentType,
			month: assignment.month,
		});
		representedFiles.add(file.fileIndex);
	}

	for (const file of files) {
		if (representedFiles.has(file.fileIndex)) continue;
		const tag = `[bank-coverage:${analysisBatchId}:type:other:file:${file.fileIndex}:support]`;
		artifacts.push({
			tag,
			description: artifactDescription(tag),
			analysisBatchId,
			fileIndex: file.fileIndex,
			file,
			documentType: "other",
		});
	}

	return artifacts;
}

export class BankStatementCoverageSaveError extends Error {
	readonly cleanupDebt: BankStatementCoverageCleanupDebt[];

	constructor(error: unknown, cleanupDebt: BankStatementCoverageCleanupDebt[]) {
		super(error instanceof Error ? error.message : String(error));
		this.name = "BankStatementCoverageSaveError";
		this.cleanupDebt = cleanupDebt;
	}
}

function cleanupDebtFromError(
	error: unknown,
): BankStatementCoverageCleanupDebt[] {
	if (error instanceof BankStatementCoverageSaveError) return error.cleanupDebt;
	if (!error || typeof error !== "object" || !("cleanupDebt" in error))
		return [];
	const debt = error.cleanupDebt;
	if (!Array.isArray(debt)) return [];
	return debt.filter(
		(item): item is BankStatementCoverageCleanupDebt =>
			!!item &&
			typeof item === "object" &&
			"status" in item &&
			item.status === "pending" &&
			"key" in item &&
			typeof item.key === "string" &&
			(!("artifactId" in item) ||
				typeof item.artifactId === "string" ||
				item.artifactId === undefined),
	);
}

export async function saveBankStatementArtifacts({
	artifacts,
	existingArtifacts,
	createArtifact,
	reuseArtifact,
	retireArtifact,
	linkArtifacts,
	commitArtifacts,
	promoteArtifact,
	refreshChecklist,
	rollbackArtifact,
	rollbackReusedArtifact,
	quarantineArtifact,
}: {
	artifacts: BankStatementArtifact[];
	existingArtifacts: SavedBankStatementArtifact[];
	createArtifact: (
		artifact: BankStatementArtifact,
	) => Promise<SavedBankStatementArtifact>;
	reuseArtifact?: (
		existing: SavedBankStatementArtifact,
		artifact: BankStatementArtifact,
	) => Promise<SavedBankStatementArtifact>;
	retireArtifact?: (artifact: SavedBankStatementArtifact) => Promise<void>;
	linkArtifacts: (artifacts: SavedBankStatementArtifact[]) => Promise<void>;
	commitArtifacts?: (
		artifacts: SavedBankStatementArtifact[],
	) => Promise<SavedBankStatementArtifact[]>;
	promoteArtifact?: (
		artifact: SavedBankStatementArtifact,
	) => Promise<SavedBankStatementArtifact>;
	refreshChecklist: () => Promise<void>;
	rollbackArtifact: (artifact: SavedBankStatementArtifact) => Promise<void>;
	rollbackReusedArtifact?: (
		artifact: SavedBankStatementArtifact,
	) => Promise<void>;
	quarantineArtifact?: (
		artifact: SavedBankStatementArtifact,
		cleanupTag: string,
	) => Promise<void>;
}): Promise<SavedBankStatementArtifact[]> {
	const existingByTag = new Map(
		existingArtifacts.map((artifact) => [artifact.tag, artifact]),
	);
	const unusedExisting = new Set(existingArtifacts);
	const created: SavedBankStatementArtifact[] = [];
	const reused: SavedBankStatementArtifact[] = [];
	try {
		const saved: SavedBankStatementArtifact[] = [];
		for (const artifact of artifacts) {
			const existing = existingByTag.get(artifact.tag);
			if (
				existing &&
				existing.documentType === artifact.documentType &&
				existing.fileIndex === artifact.fileIndex &&
				existing.file.contentSha256 === artifact.file.contentSha256
			) {
				unusedExisting.delete(existing);
				saved.push(existing);
				continue;
			}
			const reconcile = reuseArtifact;
			const reusable = reconcile
				? [...unusedExisting].find(
						(candidate) =>
							candidate.fileIndex === artifact.fileIndex &&
							candidate.file.contentSha256 === artifact.file.contentSha256,
					)
				: undefined;
			if (reusable && reconcile) {
				const reconciled = await reconcile(reusable, artifact);
				unusedExisting.delete(reusable);
				reused.push(reusable);
				saved.push(reconciled);
				continue;
			}
			const newArtifact = await createArtifact(artifact);
			created.push(newArtifact);
			saved.push(newArtifact);
		}
		await linkArtifacts(saved);
		const promoted = commitArtifacts
			? await commitArtifacts(saved)
			: await Promise.all(
					saved.map((artifact) =>
						promoteArtifact ? promoteArtifact(artifact) : artifact,
					),
				);
		if (!commitArtifacts) await refreshChecklist();
		if (retireArtifact && unusedExisting.size > 0) {
			const cleanupDebt: BankStatementCoverageCleanupDebt[] = [];
			for (const obsolete of unusedExisting) {
				try {
					await retireArtifact(obsolete);
				} catch (error) {
					if (
						error instanceof BankStatementCoverageSaveError &&
						error.cleanupDebt.length === 0
					) {
						throw error;
					}
					cleanupDebt.push({
						status: "pending",
						key: obsolete.filePath,
						artifactId: obsolete.id,
					});
				}
			}
			await refreshChecklist();
			if (cleanupDebt.length > 0) {
				throw new BankStatementCoverageSaveError(
					"No se pudieron retirar adjuntos obsoletos.",
					cleanupDebt,
				);
			}
		}
		return promoted;
	} catch (error) {
		if (
			error instanceof BankStatementCoverageSaveError &&
			(error.cleanupDebt.length === 0 || created.length === 0)
		) {
			throw error;
		}
		const cleanupDebt = [...cleanupDebtFromError(error)];
		for (const artifact of created) {
			try {
				await rollbackArtifact(artifact);
			} catch {
				const cleanupTag = `[bank-coverage-debt:${artifact.analysisBatchId}:artifact:${artifact.id}:file:${artifact.fileIndex}]`;
				await quarantineArtifact?.(artifact, cleanupTag).catch(() => undefined);
				cleanupDebt.push({
					status: "pending",
					key: artifact.filePath,
					artifactId: artifact.id,
				});
			}
		}
		if (rollbackReusedArtifact) {
			for (const artifact of reused) {
				await rollbackReusedArtifact(artifact).catch(() => undefined);
			}
		}
		await refreshChecklist().catch(() => undefined);
		throw new BankStatementCoverageSaveError(error, cleanupDebt);
	}
}

export interface BankStatementArtifactPersistenceResult {
	documents: SavedBankStatementArtifact[];
	effectiveAssignments: BankStatementChecklistAssignment[];
	pendingAssignments: BankStatementChecklistAssignment[];
}

export async function runBankStatementArtifactPersistenceCore({
	coverage,
	loadExistingDocuments,
	readStoredFile,
	createArtifact,
	reuseArtifact,
	commitArtifacts,
	promoteArtifact,
	linkArtifacts,
	refreshChecklist,
	rollbackArtifact,
	rollbackReusedArtifact,
	quarantineArtifact,
	retireArtifact,
}: {
	coverage: PersistedBankStatementCoverage;
	loadExistingDocuments: () => Promise<ExistingBankStatementDocument[]>;
	readStoredFile: (filePath: string) => Promise<Buffer>;
	createArtifact: (
		artifact: BankStatementArtifact,
	) => Promise<SavedBankStatementArtifact>;
	reuseArtifact: (
		existing: SavedBankStatementArtifact,
		artifact: BankStatementArtifact,
	) => Promise<SavedBankStatementArtifact>;
	commitArtifacts?: (
		artifacts: SavedBankStatementArtifact[],
	) => Promise<SavedBankStatementArtifact[]>;
	promoteArtifact: (
		artifact: SavedBankStatementArtifact,
	) => Promise<SavedBankStatementArtifact>;
	linkArtifacts: (artifacts: SavedBankStatementArtifact[]) => Promise<void>;
	refreshChecklist: () => Promise<void>;
	rollbackArtifact: (artifact: SavedBankStatementArtifact) => Promise<void>;
	rollbackReusedArtifact: (
		artifact: SavedBankStatementArtifact,
	) => Promise<void>;
	quarantineArtifact: (
		artifact: SavedBankStatementArtifact,
		cleanupTag: string,
	) => Promise<void>;
	retireArtifact: (artifact: SavedBankStatementArtifact) => Promise<void>;
}): Promise<BankStatementArtifactPersistenceResult> {
	const existingDocuments = await loadExistingDocuments();
	const plan = buildBankStatementArtifactPlan({
		analysisBatchId: coverage.analysisBatchId,
		files: coverage.files,
		coverage,
		existingDocuments,
	});
	const ownedPrefix = batchPrefix(coverage.analysisBatchId);
	const existingArtifacts: SavedBankStatementArtifact[] = [];
	for (const document of existingDocuments) {
		const tag = getBankStatementArtifactTag(document.description);
		if (!tag?.startsWith(ownedPrefix)) continue;
		const fileIndex = Number(tag.match(/:file:(\d+)/)?.[1]);
		const file = coverage.files.find(
			(candidate) => candidate.fileIndex === fileIndex,
		);
		if (!file) {
			throw new Error(
				"Un adjunto de cobertura no corresponde al lote guardado.",
			);
		}
		const documentType =
			document.documentType === "estados_cuenta_1" ||
			document.documentType === "estados_cuenta_2" ||
			document.documentType === "estados_cuenta_3" ||
			document.documentType === "other"
				? document.documentType
				: undefined;
		if (!documentType) {
			throw new Error("Un adjunto de cobertura tiene un tipo inválido.");
		}
		const buffer = await readStoredFile(document.filePath);
		if (
			createHash("sha256").update(buffer).digest("hex") !== file.contentSha256
		) {
			throw new Error(
				"Un adjunto de cobertura no coincide con la evidencia analizada.",
			);
		}
		existingArtifacts.push({
			tag,
			description: document.description ?? tag,
			analysisBatchId: coverage.analysisBatchId,
			fileIndex,
			file,
			documentType,
			month: tag.match(/:month:(\d{4}-(?:0[1-9]|1[0-2]))/)?.[1],
			id: document.id,
			filePath: document.filePath,
		});
	}
	const documents = await saveBankStatementArtifacts({
		artifacts: plan,
		existingArtifacts,
		createArtifact,
		reuseArtifact,
		commitArtifacts,
		promoteArtifact,
		linkArtifacts,
		refreshChecklist,
		rollbackArtifact,
		rollbackReusedArtifact,
		quarantineArtifact,
		retireArtifact,
	});
	const requestedAssignments =
		coverage.requestedChecklistAssignments ?? coverage.checklistAssignments;
	const effectiveAssignments = plan.flatMap((planned) => {
		if (planned.documentType === "other" || !planned.month) return [];
		const saved = documents.find(
			(document) =>
				document.tag === planned.tag &&
				document.documentType === planned.documentType &&
				document.fileIndex === planned.fileIndex,
		);
		const assignment = requestedAssignments.find(
			(candidate) =>
				candidate.month === planned.month &&
				candidate.fileIndex === planned.fileIndex,
		);
		return saved && assignment
			? [{ ...assignment, documentType: planned.documentType }]
			: [];
	});
	if (
		new Set(effectiveAssignments.map(({ documentType }) => documentType))
			.size !== effectiveAssignments.length
	) {
		throw new Error("La cobertura produjo tipos documentales duplicados.");
	}
	const effectiveKeys = new Set(
		effectiveAssignments.map(
			(assignment) => `${assignment.month}:${assignment.fileIndex}`,
		),
	);
	return {
		documents,
		effectiveAssignments,
		pendingAssignments: requestedAssignments.filter(
			(assignment) =>
				!effectiveKeys.has(`${assignment.month}:${assignment.fileIndex}`),
		),
	};
}

export async function runBankStatementCleanupDebtCore({
	opportunityId,
	analysisBatchId,
	debt,
	readArtifact,
	deleteStoredFile,
	deleteArtifact,
	refreshChecklist,
}: {
	opportunityId: string;
	analysisBatchId: string;
	debt: BankStatementCoverageCleanupDebt[];
	readArtifact: (artifactId: string) => Promise<{
		id: string;
		description: string | null;
		filePath: string;
	} | null>;
	deleteStoredFile: (key: string) => Promise<void>;
	deleteArtifact: (artifactId: string) => Promise<void>;
	refreshChecklist: () => Promise<void>;
}): Promise<BankStatementCoverageCleanupDebt[]> {
	const remaining: BankStatementCoverageCleanupDebt[] = [];
	const ownedPrefix = batchPrefix(analysisBatchId);
	const ownedDebtPrefix = `[bank-coverage-debt:${analysisBatchId}:`;
	for (const item of debt) {
		try {
			if (!item.artifactId) {
				if (!item.key.startsWith(`opportunities/${opportunityId}/`)) {
					throw new Error(
						"La deuda de limpieza no pertenece a la oportunidad.",
					);
				}
				await deleteStoredFile(item.key);
				continue;
			}
			const artifact = await readArtifact(item.artifactId);
			if (
				artifact &&
				(artifact.filePath !== item.key ||
					(!artifact.description?.startsWith(ownedPrefix) &&
						!artifact.description?.startsWith(ownedDebtPrefix)))
			) {
				throw new Error(
					"La deuda de limpieza ya no corresponde al lote actual.",
				);
			}
			await deleteStoredFile(item.key);
			if (artifact) {
				await deleteArtifact(artifact.id);
				await refreshChecklist();
			}
		} catch {
			remaining.push(item);
		}
	}
	return remaining;
}

export interface ResettableBankStatementArtifact {
	id: string;
	documentType: string;
	description: string | null;
	filePath: string;
}

function isOwnedBankStatementResetArtifact(
	artifact: ResettableBankStatementArtifact,
	analysisBatchId: string,
) {
	return (
		artifact.description?.startsWith(batchPrefix(analysisBatchId)) === true ||
		artifact.description?.startsWith(
			`[bank-coverage-debt:${analysisBatchId}:`,
		) === true
	);
}

export interface OpportunityCreditAnalysisResetReservation {
	analysisId: string;
	token: string;
}

export async function runOpportunityCreditAnalysisResetCore({
	opportunityId,
	reserveReset,
	releaseReset,
	assertResetCurrent,
	loadAnalysis,
	loadDocuments,
	persistRecovery,
	quarantineArtifactsAndRefresh,
	deleteStoredFile,
	deleteArtifactAndRefresh,
	deleteAnalysis,
}: {
	opportunityId: string;
	reserveReset: () => Promise<OpportunityCreditAnalysisResetReservation | null>;
	releaseReset: (
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
	assertResetCurrent: (
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
	loadAnalysis: (
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<{
		id: string;
		coverage: PersistedBankStatementCoverage | null;
	} | null>;
	loadDocuments: (
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<ResettableBankStatementArtifact[]>;
	persistRecovery: (
		analysisId: string,
		coverage: PersistedBankStatementCoverage,
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
	quarantineArtifactsAndRefresh: (
		artifacts: ResettableBankStatementArtifact[],
		analysisBatchId: string,
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
	deleteStoredFile: (
		key: string,
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
	deleteArtifactAndRefresh: (
		artifact: ResettableBankStatementArtifact,
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
	deleteAnalysis: (
		analysisId: string,
		reservation: OpportunityCreditAnalysisResetReservation,
	) => Promise<void>;
}): Promise<{ id: string } | null> {
	const reservation = await reserveReset();
	if (!reservation) return null;
	try {
		await assertResetCurrent(reservation);
		const analysis = await loadAnalysis(reservation);
		if (!analysis) return null;
		if (!analysis.coverage) {
			await assertResetCurrent(reservation);
			await deleteAnalysis(analysis.id, reservation);
			return { id: analysis.id };
		}

		const { coverage } = analysis;
		await assertResetCurrent(reservation);
		const documents = await loadDocuments(reservation);
		const artifacts = documents.filter((artifact) =>
			isOwnedBankStatementResetArtifact(artifact, coverage.analysisBatchId),
		);
		const debtByKey = new Map<string, BankStatementCoverageCleanupDebt>();
		for (const item of coverage.cleanupDebt ?? []) {
			debtByKey.set(`${item.artifactId ?? ""}:${item.key}`, item);
		}
		for (const artifact of artifacts) {
			debtByKey.set(`${artifact.id}:${artifact.filePath}`, {
				status: "pending",
				key: artifact.filePath,
				artifactId: artifact.id,
			});
		}
		const recoveryCoverage = (
			cleanupDebt: BankStatementCoverageCleanupDebt[],
		): PersistedBankStatementCoverage => ({
			...coverage,
			saveStatus: "failed",
			saveError:
				"El restablecimiento está limpiando los adjuntos del análisis anterior.",
			cleanupDebt: cleanupDebt.length > 0 ? cleanupDebt : undefined,
			checklistAssignments: [],
			pendingChecklistAssignments:
				coverage.requestedChecklistAssignments ?? coverage.checklistAssignments,
			savedDocuments: [],
		});
		const plannedDebt = [...debtByKey.values()];
		await assertResetCurrent(reservation);
		await persistRecovery(
			analysis.id,
			recoveryCoverage(plannedDebt),
			reservation,
		);
		if (artifacts.length > 0) {
			await assertResetCurrent(reservation);
			await quarantineArtifactsAndRefresh(
				artifacts,
				coverage.analysisBatchId,
				reservation,
			);
		}

		const artifactById = new Map(
			artifacts.map((artifact) => [artifact.id, artifact]),
		);
		const documentById = new Map(
			documents.map((document) => [document.id, document]),
		);
		const remaining: BankStatementCoverageCleanupDebt[] = [];
		for (const item of plannedDebt) {
			try {
				if (!item.key.startsWith(`opportunities/${opportunityId}/`)) {
					throw new Error(
						"La deuda de limpieza no pertenece a la oportunidad.",
					);
				}
				const currentDocument = item.artifactId
					? documentById.get(item.artifactId)
					: undefined;
				const artifact = item.artifactId
					? artifactById.get(item.artifactId)
					: undefined;
				if (
					currentDocument &&
					(!artifact || currentDocument.filePath !== item.key)
				) {
					throw new Error("La deuda de limpieza no pertenece al lote actual.");
				}
				await assertResetCurrent(reservation);
				await deleteStoredFile(item.key, reservation);
				if (artifact) {
					await assertResetCurrent(reservation);
					await deleteArtifactAndRefresh(artifact, reservation);
				}
			} catch {
				remaining.push(item);
			}
		}
		if (remaining.length > 0) {
			await assertResetCurrent(reservation);
			await persistRecovery(
				analysis.id,
				recoveryCoverage(remaining),
				reservation,
			);
			throw new BankStatementCoverageSaveError(
				"No se pudieron limpiar los adjuntos del análisis anterior.",
				remaining,
			);
		}
		try {
			await assertResetCurrent(reservation);
			await deleteAnalysis(analysis.id, reservation);
		} catch (error) {
			await assertResetCurrent(reservation);
			await persistRecovery(analysis.id, recoveryCoverage([]), reservation);
			throw error;
		}
		return { id: analysis.id };
	} finally {
		await releaseReset(reservation);
	}
}

export function getInitialBankStatementCoverageSaveStatus({
	hasOpportunity,
	canAutoAttach,
}: {
	hasOpportunity: boolean;
	canAutoAttach: boolean;
}): BankStatementCoverageSaveStatus {
	return hasOpportunity && canAutoAttach ? "pending" : "not_applicable";
}

export async function runInitialBankStatementHandlerCore<
	TGenerated,
	TPrepared extends { coverage: PersistedBankStatementCoverage },
>({
	generateAnalysis,
	prepareAnalysis,
	persistAnalysis,
	validateCurrent,
	persistCoverage,
	cleanupDebt,
	saveArtifacts,
}: {
	generateAnalysis: () => Promise<TGenerated>;
	prepareAnalysis: (analysis: TGenerated) => Promise<TPrepared>;
	persistAnalysis: (prepared: TPrepared) => Promise<void>;
	validateCurrent: (prepared: TPrepared) => Promise<void>;
	persistCoverage: (
		coverage: PersistedBankStatementCoverage,
		prepared: TPrepared,
	) => Promise<void>;
	cleanupDebt: (
		debt: BankStatementCoverageCleanupDebt[],
		prepared: TPrepared,
	) => Promise<BankStatementCoverageCleanupDebt[]>;
	saveArtifacts: (
		coverage: PersistedBankStatementCoverage,
		prepared: TPrepared,
	) => Promise<BankStatementArtifactPersistenceResult>;
}): Promise<
	Omit<TPrepared, "coverage"> & {
		coverage: PersistedBankStatementCoverage;
	}
> {
	const generated = await generateAnalysis();
	const prepared = await prepareAnalysis(generated);
	await persistAnalysis(prepared);
	const coverage = await runBankStatementCoverageSaveLifecycle({
		coverage: prepared.coverage,
		validateCurrent: () => validateCurrent(prepared),
		persistCoverage: (nextCoverage) => persistCoverage(nextCoverage, prepared),
		cleanupDebt: (debt) => cleanupDebt(debt, prepared),
		saveArtifacts: (nextCoverage) => saveArtifacts(nextCoverage, prepared),
	});
	return { ...prepared, coverage };
}

export async function runBankStatementCoverageSaveLifecycle({
	coverage,
	validateCurrent,
	persistCoverage,
	cleanupDebt,
	saveArtifacts,
}: {
	coverage: PersistedBankStatementCoverage;
	validateCurrent: () => Promise<void>;
	persistCoverage: (coverage: PersistedBankStatementCoverage) => Promise<void>;
	cleanupDebt: (
		debt: BankStatementCoverageCleanupDebt[],
	) => Promise<BankStatementCoverageCleanupDebt[]>;
	saveArtifacts: (coverage: PersistedBankStatementCoverage) => Promise<{
		documents: SavedBankStatementArtifact[];
		effectiveAssignments: BankStatementChecklistAssignment[];
		pendingAssignments: BankStatementChecklistAssignment[];
	}>;
}): Promise<PersistedBankStatementCoverage> {
	await validateCurrent();
	if (coverage.saveStatus === "not_applicable") {
		await persistCoverage(coverage);
		return coverage;
	}
	const pending: PersistedBankStatementCoverage = {
		...coverage,
		saveStatus: "pending",
		saveError: undefined,
	};
	await persistCoverage(pending);
	const remainingDebt = await cleanupDebt(pending.cleanupDebt ?? []);
	if (remainingDebt.length > 0) {
		const failed = {
			...pending,
			saveStatus: "failed" as const,
			saveError: "No se pudieron limpiar adjuntos pendientes.",
			cleanupDebt: remainingDebt,
		};
		await persistCoverage(failed);
		return failed;
	}
	try {
		const result = await saveArtifacts(pending);
		const stillPending = result.pendingAssignments.length > 0;
		const saved: PersistedBankStatementCoverage = {
			...pending,
			saveStatus: stillPending ? "pending" : "saved",
			saveError: stillPending
				? "Hay meses pendientes porque los espacios documentales están ocupados."
				: undefined,
			cleanupDebt: undefined,
			checklistAssignments: result.effectiveAssignments,
			pendingChecklistAssignments: result.pendingAssignments,
			savedDocuments: result.documents.map((document) => ({
				id: document.id,
				tag: document.tag,
				fileIndex: document.fileIndex,
				documentType: document.documentType,
				month: document.month,
			})),
		};
		await persistCoverage(saved);
		return saved;
	} catch (error) {
		const failed: PersistedBankStatementCoverage = {
			...pending,
			saveStatus: "failed",
			saveError: "No se pudieron guardar los adjuntos. Reintenta el guardado.",
			cleanupDebt: cleanupDebtFromError(error),
		};
		await persistCoverage(failed);
		return failed;
	}
}

export async function runReservedBankStatementCoverageMutationCore<
	TReservation,
	TCurrentOpportunity,
	TCurrentCoverage,
	TResult,
>({
	reserve,
	loadCurrentOpportunity,
	loadCurrentCoverage,
	mutateCurrentCoverage,
	release,
}: {
	reserve: () => Promise<TReservation>;
	loadCurrentOpportunity: (
		reservation: TReservation,
	) => Promise<TCurrentOpportunity>;
	loadCurrentCoverage: (
		reservation: TReservation,
		opportunity: TCurrentOpportunity,
	) => Promise<TCurrentCoverage>;
	mutateCurrentCoverage: (
		coverage: TCurrentCoverage,
		reservation: TReservation,
		opportunity: TCurrentOpportunity,
	) => Promise<TResult>;
	release: (reservation: TReservation) => Promise<void>;
}): Promise<TResult> {
	const reservation = await reserve();
	try {
		const opportunity = await loadCurrentOpportunity(reservation);
		const coverage = await loadCurrentCoverage(reservation, opportunity);
		return await mutateCurrentCoverage(coverage, reservation, opportunity);
	} finally {
		await release(reservation);
	}
}

export async function runBankStatementCoverageMutationHandlerCore({
	coverage,
	manualDeclaration,
	actorId,
	declaredAt,
	validateCurrent,
	persistCoverage,
	cleanupDebt,
	saveArtifacts,
}: {
	coverage: PersistedBankStatementCoverage;
	manualDeclaration?: { fileIndex: number; months: string[] };
	actorId: string;
	declaredAt: string;
	validateCurrent: () => Promise<void>;
	persistCoverage: (coverage: PersistedBankStatementCoverage) => Promise<void>;
	cleanupDebt: (
		debt: BankStatementCoverageCleanupDebt[],
	) => Promise<BankStatementCoverageCleanupDebt[]>;
	saveArtifacts: (
		coverage: PersistedBankStatementCoverage,
	) => Promise<BankStatementArtifactPersistenceResult>;
}): Promise<PersistedBankStatementCoverage> {
	let nextCoverage: PersistedBankStatementCoverage = {
		...coverage,
		saveStatus: "pending",
		saveError: undefined,
	};
	if (manualDeclaration) {
		const targetFile = coverage.files.find(
			(file) => file.fileIndex === manualDeclaration.fileIndex,
		);
		if (!targetFile || targetFile.status !== "needs_confirmation") {
			throw new Error("Este archivo ya no requiere confirmación mensual.");
		}
		const resolved = applyManualCoverageDeclaration({
			coverage,
			fileIndex: manualDeclaration.fileIndex,
			months: manualDeclaration.months,
			actorId,
			declaredAt,
		});
		nextCoverage = {
			...coverage,
			...resolved,
			saveStatus: "pending",
			saveError: undefined,
			requestedChecklistAssignments: resolved.checklistAssignments,
			pendingChecklistAssignments: undefined,
			files: resolved.files.map((file) => ({
				...coverage.files[file.fileIndex],
				...file,
			})),
		};
	}
	return runBankStatementCoverageSaveLifecycle({
		coverage: nextCoverage,
		validateCurrent,
		persistCoverage,
		cleanupDebt,
		saveArtifacts,
	});
}

export function applyManualCoverageDeclaration({
	coverage,
	fileIndex,
	months,
	actorId,
	declaredAt,
}: {
	coverage: ResolvedBankStatementCoverage;
	fileIndex: number;
	months: string[];
	actorId: string;
	declaredAt: string;
}): ResolvedBankStatementCoverage {
	if (
		!Number.isInteger(fileIndex) ||
		fileIndex < 0 ||
		fileIndex >= coverage.files.length ||
		months.length === 0 ||
		!months.every(isCanonicalBankStatementMonth)
	) {
		throw new Error("La declaración mensual no es válida");
	}
	const previous = coverage.manualDeclarations.filter(
		(declaration) => declaration.fileIndex !== fileIndex,
	);
	const detectedMonths =
		coverage.files.find((file) => file.fileIndex === fileIndex)
			?.detectedMonths ?? [];
	const declaration: BankStatementManualDeclaration = {
		fileIndex,
		months: [...new Set(months)].sort(),
		detectedMonths: [...detectedMonths],
		actorId,
		declaredAt,
	};
	return resolveBankStatementMonthlyCoverage({
		uploadedFileCount: coverage.files.length,
		coverageByFile: coverage.reportedCoverage,
		manualDeclarations: [...previous, declaration],
	});
}

export function assertBankStatementCoverageMutation(context: {
	requestedOpportunityId: string;
	requestedAnalysisId: string;
	requestedLeadId: string;
	currentOpportunityId: string | null;
	currentAnalysisId: string;
	currentLeadId: string | null;
	requestedAnalysisBatchId: string;
	currentAnalysisBatchId: string;
	canWrite: boolean;
	integrityBatchCurrent: boolean;
}): void {
	if (!context.canWrite)
		throw new Error("Sin permiso para modificar cobertura");
	if (
		context.requestedOpportunityId !== context.currentOpportunityId ||
		context.requestedAnalysisId !== context.currentAnalysisId ||
		context.requestedLeadId !== context.currentLeadId ||
		context.requestedAnalysisBatchId !== context.currentAnalysisBatchId
	) {
		throw new Error("El análisis ya no corresponde al lote actual");
	}
	if (!context.integrityBatchCurrent) {
		throw new Error(
			"La validación documental ya no corresponde al lote actual",
		);
	}
}
