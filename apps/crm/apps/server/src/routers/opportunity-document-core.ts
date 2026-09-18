import {
	BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES,
	type BankStatementOpportunityDocumentType,
} from "../lib/bank-statement-documents";

export class OpportunityDocumentMutationError extends Error {
	constructor(
		public readonly code: "NOT_FOUND" | "CONFLICT",
		message: string,
	) {
		super(message);
		this.name = "OpportunityDocumentMutationError";
	}
}

export interface ManualBankDocumentCleanupDebt {
	status: "pending";
	purpose: "upload_cleanup";
	key: string;
	opportunityId: string;
	actorId: string;
	documentType: BankStatementOpportunityDocumentType;
}

export function isBankStatementChecklistType(
	documentType: string,
): documentType is BankStatementOpportunityDocumentType {
	return BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES.some(
		(bankType) => bankType === documentType,
	);
}

function isReservedCoverageArtifact(description: string | null | undefined) {
	return (
		description?.startsWith("[bank-coverage:") === true ||
		description?.startsWith("[bank-coverage-debt:") === true
	);
}

export function isManualBankDocumentCleanupDescription(
	description: string | null | undefined,
) {
	return description?.startsWith("[manual-bank-debt:") === true;
}

export function getManualBankUploadCleanupDescription(
	debt: ManualBankDocumentCleanupDebt,
) {
	return `[manual-bank-debt:${debt.purpose}:actor:${debt.actorId}:type:${debt.documentType}]`;
}

function manualDeleteCleanupTag({
	actorId,
	documentType,
}: {
	actorId: string;
	documentType: string;
}) {
	return `[manual-bank-debt:delete_cleanup:actor:${actorId}:type:${documentType}]`;
}

export async function runOpportunityDocumentUploadCore<T, TTx>({
	opportunityId,
	actorId,
	documentType,
	uploadedKey,
	withOpportunityLock,
	runTransaction,
	findExistingBankSlot,
	insertDocument,
	refreshChecklist,
	deleteUploadedFile,
	persistCleanupDebt,
}: {
	opportunityId: string;
	actorId: string;
	documentType: BankStatementOpportunityDocumentType;
	uploadedKey: string;
	withOpportunityLock: <R>(
		opportunityId: string,
		operation: () => Promise<R>,
	) => Promise<R>;
	runTransaction: <R>(operation: (tx: TTx) => Promise<R>) => Promise<R>;
	findExistingBankSlot: (tx: TTx) => Promise<unknown | null>;
	insertDocument: (tx: TTx) => Promise<T>;
	refreshChecklist: (tx: TTx, document: T) => Promise<void>;
	deleteUploadedFile: (key: string) => Promise<void>;
	persistCleanupDebt: (debt: ManualBankDocumentCleanupDebt) => Promise<void>;
}): Promise<T> {
	try {
		return await withOpportunityLock(opportunityId, () =>
			runTransaction(async (tx) => {
				if (await findExistingBankSlot(tx)) {
					throw new OpportunityDocumentMutationError(
						"CONFLICT",
						"El espacio de estado de cuenta ya está ocupado.",
					);
				}
				const document = await insertDocument(tx);
				await refreshChecklist(tx, document);
				return document;
			}),
		);
	} catch (error) {
		try {
			await deleteUploadedFile(uploadedKey);
		} catch {
			await persistCleanupDebt({
				status: "pending",
				purpose: "upload_cleanup",
				key: uploadedKey,
				opportunityId,
				actorId,
				documentType,
			});
		}
		throw error;
	}
}

export async function runOpportunityDocumentDeleteCore<
	T extends {
		description: string | null;
		documentType: string;
	},
	TTx,
>({
	documentId: _documentId,
	opportunityId,
	actorId,
	documentType,
	description,
	withOpportunityLock,
	runTransaction,
	readDocument,
	quarantineAndRefresh,
	deleteStoredFile,
	deleteDocumentAndRefresh,
}: {
	documentId: string;
	opportunityId: string;
	actorId: string;
	documentType: string;
	description?: string | null;
	withOpportunityLock: <R>(
		opportunityId: string,
		operation: () => Promise<R>,
	) => Promise<R>;
	runTransaction: <R>(operation: (tx: TTx) => Promise<R>) => Promise<R>;
	readDocument: (tx: TTx) => Promise<T | null>;
	quarantineAndRefresh: (
		tx: TTx,
		document: T,
		cleanupTag: string,
	) => Promise<void>;
	deleteStoredFile: (document: T) => Promise<void>;
	deleteDocumentAndRefresh: (tx: TTx, document: T) => Promise<void>;
}): Promise<void> {
	const remove = async () => {
		let current: T | null = null;
		await runTransaction(async (tx) => {
			current = await readDocument(tx);
			if (!current) {
				throw new OpportunityDocumentMutationError(
					"NOT_FOUND",
					"Documento no encontrado",
				);
			}
			if (isReservedCoverageArtifact(current.description)) {
				throw new OpportunityDocumentMutationError(
					"CONFLICT",
					"Este documento es administrado por la cobertura mensual y no se puede eliminar manualmente.",
				);
			}
			if (!isManualBankDocumentCleanupDescription(current.description)) {
				await quarantineAndRefresh(
					tx,
					current,
					manualDeleteCleanupTag({
						actorId,
						documentType: current.documentType,
					}),
				);
			}
		});
		if (!current) {
			throw new OpportunityDocumentMutationError(
				"NOT_FOUND",
				"Documento no encontrado",
			);
		}
		const document = current;
		await deleteStoredFile(document);
		await runTransaction((tx) => deleteDocumentAndRefresh(tx, document));
	};
	const serialized =
		isBankStatementChecklistType(documentType) ||
		isReservedCoverageArtifact(description) ||
		isManualBankDocumentCleanupDescription(description);
	if (serialized) {
		await withOpportunityLock(opportunityId, remove);
	} else {
		await remove();
	}
}
