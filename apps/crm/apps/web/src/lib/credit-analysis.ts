export function getOpportunityCreditAnalysisInput(
	leadId: string | undefined,
	opportunityId: string | undefined,
): { leadId: string; opportunityId: string } | null {
	return leadId && opportunityId ? { leadId, opportunityId } : null;
}

export function resolveAnalysisOpportunityId(
	explicitOpportunityId: string | undefined,
	urlOpportunityId: string | undefined,
	opportunities: ReadonlyArray<{ id: string }>,
): string | undefined {
	const ids = new Set(opportunities.map((opportunity) => opportunity.id));
	if (explicitOpportunityId && ids.has(explicitOpportunityId)) {
		return explicitOpportunityId;
	}
	if (urlOpportunityId && ids.has(urlOpportunityId)) {
		return urlOpportunityId;
	}
	return opportunities.length === 1 ? opportunities[0]?.id : undefined;
}
