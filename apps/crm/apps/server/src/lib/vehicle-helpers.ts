import type { Vehicle } from "../db/schema/vehicles";

/**
 * Campos requeridos para vehículos nuevos antes de cerrar la oportunidad.
 * Estos datos normalmente llegan del dealer después de la venta.
 */
const REQUIRED_FIELDS_FOR_NEW_VEHICLE = [
	"vinNumber",
	"licensePlate",
	"origin",
	"fuelType",
	"transmission",
] as const;

/**
 * Campos mínimos requeridos para avanzar a etapa 90% (contratos).
 */
const MINIMUM_FIELDS_FOR_CONTRACTS = ["vinNumber"] as const;

/**
 * Verifica si un vehículo nuevo tiene todos los datos completos
 * necesarios para cerrar la oportunidad (100%).
 *
 * Para vehículos usados siempre retorna true (ya tienen todos los datos).
 */
export function isNewVehicleDataComplete(
	vehicle: Pick<
		Vehicle,
		| "isNew"
		| "vinNumber"
		| "licensePlate"
		| "origin"
		| "fuelType"
		| "transmission"
	>,
): boolean {
	// Vehículos usados ya tienen todos los datos
	if (!vehicle.isNew) return true;

	// Verificar que todos los campos requeridos estén presentes
	return !!(
		vehicle.vinNumber &&
		vehicle.licensePlate &&
		vehicle.origin &&
		vehicle.fuelType &&
		vehicle.transmission
	);
}

/**
 * Verifica si un vehículo nuevo tiene los datos mínimos
 * necesarios para la etapa 90% (generación de contratos).
 *
 * Para vehículos usados siempre retorna true.
 */
export function hasMinimumDataForContracts(
	vehicle: Pick<Vehicle, "isNew" | "vinNumber">,
): boolean {
	// Vehículos usados ya tienen todos los datos
	if (!vehicle.isNew) return true;

	// Para contratos, al menos necesitamos el VIN
	return !!vehicle.vinNumber;
}

/**
 * Obtiene la lista de campos faltantes para un vehículo nuevo.
 * Útil para mostrar en la UI qué datos faltan por completar.
 *
 * Para vehículos usados retorna array vacío.
 */
export function getMissingFields(
	vehicle: Pick<
		Vehicle,
		| "isNew"
		| "vinNumber"
		| "licensePlate"
		| "origin"
		| "fuelType"
		| "transmission"
	>,
): string[] {
	// Vehículos usados no tienen campos faltantes
	if (!vehicle.isNew) return [];

	const missing: string[] = [];

	if (!vehicle.vinNumber) missing.push("VIN");
	if (!vehicle.licensePlate) missing.push("Placa");
	if (!vehicle.origin) missing.push("Origen");
	if (!vehicle.fuelType) missing.push("Tipo de combustible");
	if (!vehicle.transmission) missing.push("Transmisión");

	return missing;
}

/**
 * Obtiene los campos faltantes mínimos para contratos (etapa 90%).
 */
export function getMissingFieldsForContracts(
	vehicle: Pick<Vehicle, "isNew" | "vinNumber">,
): string[] {
	if (!vehicle.isNew) return [];

	const missing: string[] = [];

	if (!vehicle.vinNumber) missing.push("VIN");

	return missing;
}

/**
 * Formatea los campos faltantes para mostrar en mensajes de error.
 */
export function formatMissingFields(fields: string[]): string {
	if (fields.length === 0) return "";
	if (fields.length === 1) return fields[0];
	if (fields.length === 2) return `${fields[0]} y ${fields[1]}`;

	const last = fields.pop();
	return `${fields.join(", ")} y ${last}`;
}
