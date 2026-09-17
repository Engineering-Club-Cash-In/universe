export type LeadDuplicateConflict = {
	reason: "DUPLICATE_DPI";
	leadId: string;
	leadName: string;
	isActive: boolean;
	assignedToName: string;
	assignedToCurrentUser: boolean;
};

type MatchingLead = {
	id: string;
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
	assignedTo: string;
	assignedToName: string;
};

export function buildLeadDuplicateConflict(
	matchingLeads: MatchingLead[],
	activeOpportunity: { leadId: string | null } | null,
	currentUserId: string,
): LeadDuplicateConflict {
	const lead =
		matchingLeads.find((item) => item.id === activeOpportunity?.leadId) ??
		matchingLeads[0];

	if (!lead) {
		throw new Error("No se encontró el lead duplicado");
	}

	return {
		reason: "DUPLICATE_DPI",
		leadId: lead.id,
		leadName: [
			lead.firstName,
			lead.middleName,
			lead.lastName,
			lead.secondLastName,
		]
			.filter(Boolean)
			.join(" "),
		isActive: Boolean(activeOpportunity),
		assignedToName: lead.assignedToName,
		assignedToCurrentUser: lead.assignedTo === currentUserId,
	};
}
