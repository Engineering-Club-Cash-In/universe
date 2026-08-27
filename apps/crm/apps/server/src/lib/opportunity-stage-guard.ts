export const STAGE_VEHICLE_REQUIREMENT_ERROR =
	"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado.";

export const STAGE_LEAD_REQUIREMENT_ERROR =
	"La oportunidad debe conservar un cliente asignado desde la etapa jurídica (80%).";

export function getStageVehicleRequirementError(
	_fromPercentage: number,
	toPercentage: number,
	vehicleId?: string | null,
) {
	return toPercentage >= 30 && !vehicleId
		? STAGE_VEHICLE_REQUIREMENT_ERROR
		: null;
}

export function getStageLeadRequirementError(
	stagePercentage: number,
	leadId?: string | null,
) {
	return stagePercentage >= 80 && !leadId ? STAGE_LEAD_REQUIREMENT_ERROR : null;
}

export function resolveOpportunityUpdateVersion(
	currentUpdatedAt: Date,
	expectedUpdatedAt?: string,
) {
	return expectedUpdatedAt ? new Date(expectedUpdatedAt) : currentUpdatedAt;
}
