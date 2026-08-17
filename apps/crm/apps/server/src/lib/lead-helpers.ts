import type { leads } from "../db/schema/crm";

type Lead = typeof leads.$inferSelect;
type PublicLeadCreditType = "autocompra" | "sobre_vehiculo";

type ExistingPublicLeadOpportunity = {
	creditType: PublicLeadCreditType;
	campaign?: string | null;
};

type IncomingPublicLeadOpportunity = {
	creditType?: PublicLeadCreditType;
	campaign?: string;
};

export function getPublicLeadExistingOpportunityUpdates(
	existingOpportunity: ExistingPublicLeadOpportunity,
	incoming: IncomingPublicLeadOpportunity,
) {
	const updates: Partial<{
		creditType: PublicLeadCreditType;
		campaign: string;
	}> = {};

	if (
		incoming.creditType &&
		incoming.creditType !== existingOpportunity.creditType
	) {
		updates.creditType = incoming.creditType;
	}

	if (
		incoming.campaign &&
		incoming.campaign !== existingOpportunity.campaign
	) {
		updates.campaign = incoming.campaign;
	}

	return updates;
}

type PublicLeadReentry = {
	/** Lo que el cliente escribió en el formulario, si escribió algo. */
	notes?: string;
	/** Canal por el que volvió a entrar, ya en texto legible. */
	sourceLabel: string;
	/** Día calendario de Guatemala (YYYY-MM-DD). */
	dateStr: string;
};

/**
 * Notas resultantes de una re-entrada del cliente por el formulario público.
 *
 * Cuando el lead ya tiene un proceso abierto no se crea otra oportunidad, así
 * que lo que el cliente escribió se anexa a la que ya está en curso en lugar de
 * perderse. Devuelve `null` cuando no hay nada que anexar (no escribió nada, o
 * esa misma línea ya está registrada porque el formulario se reenvió).
 */
export function buildPublicLeadReentryNote(
	currentNotes: string | null | undefined,
	reentry: PublicLeadReentry,
): string | null {
	const incoming = reentry.notes?.trim();

	if (!incoming) {
		return null;
	}

	const line = `[${reentry.dateStr} · ${reentry.sourceLabel}] ${incoming}`;
	const current = currentNotes?.trim();

	if (!current) {
		return line;
	}

	if (current.includes(line)) {
		return null;
	}

	return `${current}\n${line}`;
}

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
