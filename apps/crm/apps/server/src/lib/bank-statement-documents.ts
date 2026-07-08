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
