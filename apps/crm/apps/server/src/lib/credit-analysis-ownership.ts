import { eq, type SQL } from "drizzle-orm";
import { creditAnalysis } from "../db/schema/crm";

export type CreditAnalysisOwner =
	| { leadId: string; opportunityId: string }
	| { coDebtorId: string };

export function getCreditAnalysisOwnerCondition(
	owner: CreditAnalysisOwner,
): SQL {
	return "opportunityId" in owner
		? eq(creditAnalysis.opportunityId, owner.opportunityId)
		: eq(creditAnalysis.coDebtorId, owner.coDebtorId);
}

export function getCreditAnalysisResourceId(owner: CreditAnalysisOwner): string {
	return "opportunityId" in owner ? owner.opportunityId : owner.coDebtorId;
}

export function assertOpportunityBelongsToLead(
	opportunity: { leadId: string | null },
	leadId: string,
): void {
	if (opportunity.leadId !== leadId) {
		throw new Error("La oportunidad no pertenece al lead analizado");
	}
}
