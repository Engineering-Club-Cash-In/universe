import type { Vehicle } from "../db/schema/vehicles";

/**
 * Campos mínimos requeridos para generar contratos legales.
 * Aplica a todos los vehículos (nuevos y usados).
 */
export function getMissingFieldsForContracts(
	vehicle: Pick<
		Vehicle,
		"vinNumber" | "motorNumber" | "seats" | "vehicleUse"
	>,
): string[] {
	const requiredForContracts = [
		{ field: "vinNumber" as const, label: "VIN/Chasis" },
		{ field: "motorNumber" as const, label: "Número de Motor" },
		{ field: "seats" as const, label: "Asientos" },
		{ field: "vehicleUse" as const, label: "Uso (Particular/Comercial)" },
	];

	return requiredForContracts
		.filter((f) => !vehicle[f.field])
		.map((f) => f.label);
}

/**
 * Campos completos requeridos para cerrar oportunidad (100%).
 * Solo aplica a vehículos nuevos.
 */
export function getMissingFieldsForCompletion(
	vehicle: Pick<
		Vehicle,
		| "isNew"
		| "vinNumber"
		| "motorNumber"
		| "seats"
		| "vehicleUse"
		| "licensePlate"
		| "origin"
		| "fuelType"
		| "transmission"
	>,
): string[] {
	// Vehículos usados no requieren esta validación adicional
	if (!vehicle.isNew) return [];

	const requiredForCompletion = [
		{ field: "vinNumber" as const, label: "VIN/Chasis" },
		{ field: "motorNumber" as const, label: "Número de Motor" },
		{ field: "seats" as const, label: "Asientos" },
		{ field: "vehicleUse" as const, label: "Uso (Particular/Comercial)" },
		{ field: "licensePlate" as const, label: "Placa" },
		{ field: "origin" as const, label: "Origen" },
		{ field: "fuelType" as const, label: "Tipo de Combustible" },
		{ field: "transmission" as const, label: "Transmisión" },
	];

	return requiredForCompletion
		.filter((f) => !vehicle[f.field])
		.map((f) => f.label);
}

/**
 * Verifica si un vehículo tiene los datos mínimos para generar contratos.
 */
export function hasMinimumDataForContracts(
	vehicle: Pick<Vehicle, "vinNumber" | "motorNumber" | "seats" | "vehicleUse">,
): boolean {
	return getMissingFieldsForContracts(vehicle).length === 0;
}

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
		| "motorNumber"
		| "seats"
		| "vehicleUse"
		| "licensePlate"
		| "origin"
		| "fuelType"
		| "transmission"
	>,
): boolean {
	// Vehículos usados ya tienen todos los datos
	if (!vehicle.isNew) return true;

	return getMissingFieldsForCompletion(vehicle).length === 0;
}

/**
 * Obtiene la lista de campos faltantes para un vehículo nuevo.
 * Útil para mostrar en la UI qué datos faltan por completar.
 *
 * Para vehículos usados retorna array vacío.
 * @deprecated Usar getMissingFieldsForCompletion en su lugar
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
 * Formatea los campos faltantes para mostrar en mensajes de error.
 */
export function formatMissingFields(fields: string[]): string {
	if (fields.length === 0) return "";
	if (fields.length === 1) return fields[0];
	if (fields.length === 2) return `${fields[0]} y ${fields[1]}`;

	const fieldsCopy = [...fields];
	const last = fieldsCopy.pop();
	return `${fieldsCopy.join(", ")} y ${last}`;
}
