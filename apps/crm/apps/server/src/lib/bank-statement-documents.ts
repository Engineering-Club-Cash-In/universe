export const BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES = [
	"estados_cuenta_1",
	"estados_cuenta_2",
	"estados_cuenta_3",
] as const;

export type BankStatementOpportunityDocumentType =
	(typeof BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES)[number];

export function getBankStatementOpportunityDocumentType(
	index: number,
): BankStatementOpportunityDocumentType | undefined {
	return BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES[index];
}

// Mapea cada slot del checklist (estados_cuenta_1/2/3) al índice del archivo
// subido que le corresponde, reutilizando el último cuando hay más estados
// de cuenta detectados que archivos.
export function resolveBankStatementDocumentSlots({
	uploadedFileCount,
	statementsDetected,
}: {
	uploadedFileCount: number;
	statementsDetected: number;
}): number[] {
	const maxSlots = BANK_STATEMENT_OPPORTUNITY_DOCUMENT_TYPES.length;
	const cappedFiles = Math.min(uploadedFileCount, maxSlots);
	if (cappedFiles === 0) {
		return [];
	}

	const cappedStatements = Math.min(statementsDetected, maxSlots);
	const slotsToFill = Math.max(cappedStatements, cappedFiles);

	return Array.from({ length: slotsToFill }, (_, slot) =>
		Math.min(slot, cappedFiles - 1),
	);
}

export function canAutoAttachBankStatementDocuments({
	userRole,
	userId,
	opportunityAssignedTo,
}: {
	userRole: string;
	userId: string;
	opportunityAssignedTo: string;
}) {
	if (!["admin", "sales", "sales_supervisor", "analyst"].includes(userRole)) {
		return false;
	}

	return userRole !== "sales" || opportunityAssignedTo === userId;
}
