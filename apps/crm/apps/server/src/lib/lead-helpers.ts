import type { leads } from "../db/schema/crm";

type Lead = typeof leads.$inferSelect;

/**
 * Campos del lead requeridos para generar contratos legales.
 */
export function getMissingLeadFieldsForContracts(
	lead: Pick<
		Lead,
		| "dpi"
		| "direccion"
		| "maritalStatus"
		| "gender"
		| "birthDate"
		| "nationality"
	>,
): string[] {
	const requiredForContracts = [
		{ field: "dpi" as const, label: "DPI" },
		{ field: "direccion" as const, label: "Dirección" },
		{ field: "maritalStatus" as const, label: "Estado Civil" },
		{ field: "gender" as const, label: "Género" },
		{ field: "birthDate" as const, label: "Fecha de Nacimiento" },
		{ field: "nationality" as const, label: "Nacionalidad" },
	];

	return requiredForContracts.filter((f) => !lead[f.field]).map((f) => f.label);
}

/**
 * Campos del lead que pueden obtenerse automáticamente de RENAP.
 */
export function getRenapRequiredFields(
	lead: Pick<Lead, "gender" | "birthDate" | "nationality">,
): string[] {
	const renapFields = [
		{ field: "gender" as const, label: "Género" },
		{ field: "birthDate" as const, label: "Fecha de Nacimiento" },
		{ field: "nationality" as const, label: "Nacionalidad" },
	];

	return renapFields.filter((f) => !lead[f.field]).map((f) => f.label);
}

/**
 * Verifica si el lead tiene todos los datos necesarios para contratos.
 */
export function hasMinimumLeadDataForContracts(
	lead: Pick<
		Lead,
		| "dpi"
		| "direccion"
		| "maritalStatus"
		| "gender"
		| "birthDate"
		| "nationality"
	>,
): boolean {
	return getMissingLeadFieldsForContracts(lead).length === 0;
}

/**
 * Formatea los campos faltantes para mostrar en mensajes de error.
 */
export function formatMissingLeadFields(fields: string[]): string {
	if (fields.length === 0) return "";
	if (fields.length === 1) return fields[0];
	if (fields.length === 2) return `${fields[0]} y ${fields[1]}`;

	const fieldsCopy = [...fields];
	const last = fieldsCopy.pop();
	return `${fieldsCopy.join(", ")} y ${last}`;
}
