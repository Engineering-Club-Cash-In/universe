export type OpportunityCompanyPatch = {
	companyId?: string | null;
};

export function buildOpportunityCompanyPatch(
	companyId: string | null | undefined,
): OpportunityCompanyPatch {
	return companyId === undefined ? {} : { companyId };
}
