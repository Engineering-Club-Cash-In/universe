export const STAGE_VEHICLE_REQUIREMENT_ERROR =
	"Para avanzar a esta etapa, la oportunidad debe tener un vehículo asignado.";

export function getStageVehicleRequirementError(
	_fromPercentage: number,
	toPercentage: number,
	vehicleId?: string | null,
) {
	return toPercentage >= 30 && !vehicleId
		? STAGE_VEHICLE_REQUIREMENT_ERROR
		: null;
}
