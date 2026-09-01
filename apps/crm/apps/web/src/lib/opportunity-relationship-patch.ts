export type OpportunityRelationshipPatch = {
	leadId?: string | null;
	companyId?: string | null;
	vehicleId?: string | null;
};

type ModalRelationshipValues = {
	leadId: string | null;
	companyId: string | null;
	vehicleId: string | null;
};

type CurrentOpportunityRelationships = {
	lead?: { id?: string | null } | null;
	company?: { id?: string | null } | null;
	vehicleId?: string | null;
};

function normalizeRelationshipValue(value: string | null | undefined) {
	return value && value !== "none" ? value : null;
}

function addChangedRelationship(
	patch: OpportunityRelationshipPatch,
	key: keyof OpportunityRelationshipPatch,
	next: string | null,
	current: string | null,
) {
	if (next !== current) patch[key] = next;
}

export function buildOpportunityRelationshipPatch(params: {
	values: ModalRelationshipValues;
	opportunity: CurrentOpportunityRelationships;
	/** La empresa solo representa agencia cuando el vehículo es nuevo. */
	vehicleIsNew?: boolean | null;
}): OpportunityRelationshipPatch {
	const patch: OpportunityRelationshipPatch = {};
	const nextVehicleId = normalizeRelationshipValue(params.values.vehicleId);
	const vehicleChanged =
		nextVehicleId !== (params.opportunity.vehicleId ?? null);
	const nextCompanyId =
		vehicleChanged && params.vehicleIsNew === false
			? null
			: normalizeRelationshipValue(params.values.companyId);

	addChangedRelationship(
		patch,
		"leadId",
		normalizeRelationshipValue(params.values.leadId),
		params.opportunity.lead?.id ?? null,
	);
	addChangedRelationship(
		patch,
		"companyId",
		nextCompanyId,
		params.opportunity.company?.id ?? null,
	);
	addChangedRelationship(
		patch,
		"vehicleId",
		nextVehicleId,
		params.opportunity.vehicleId ?? null,
	);
	return patch;
}
