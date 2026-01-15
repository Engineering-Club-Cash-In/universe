/**
 * Constantes compartidas para el CRM
 * Mantener sincronizado con apps/server/src/utils/constants.ts
 */

/**
 * Estados de vehículos que NO están disponibles para asignar a oportunidades.
 * Vehículos con estos estados NO aparecerán en los dropdowns de selección.
 * Para agregar/quitar estados no disponibles, solo modificar este array.
 */
export const VEHICLE_UNAVAILABLE_STATUSES = ["sold"] as const;

/**
 * Verifica si un vehículo está disponible para asignar a una oportunidad.
 * @param status - El estado del vehículo
 * @param currentVehicleId - ID del vehículo actualmente asignado (opcional, para edición)
 * @param vehicleId - ID del vehículo a verificar
 * @returns true si el vehículo está disponible para selección
 */
export function isVehicleAvailable(
	status: string,
	currentVehicleId?: string | null,
	vehicleId?: string,
): boolean {
	// Si es el vehículo actualmente asignado, siempre mostrarlo
	if (currentVehicleId && vehicleId && currentVehicleId === vehicleId) {
		return true;
	}
	// Si no, verificar que el estado NO esté en la lista de no disponibles
	return !VEHICLE_UNAVAILABLE_STATUSES.includes(
		status as (typeof VEHICLE_UNAVAILABLE_STATUSES)[number],
	);
}
