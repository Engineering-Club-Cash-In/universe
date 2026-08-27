import { sql } from "drizzle-orm";
import { opportunities, salesStages } from "../db/schema";
import { PERMISSIONS } from "./roles";

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

export function buildOpportunityRelationshipInvariantCondition(input: {
	stageId?: string;
	leadId?: string | null;
}) {
	const effectiveStageId = input.stageId
		? sql`${input.stageId}::uuid`
		: sql`${opportunities.stageId}`;
	const effectiveLeadId =
		"leadId" in input
			? sql`${input.leadId}::uuid`
			: sql`${opportunities.leadId}`;

	return sql<boolean>`(
		COALESCE((
			SELECT ${salesStages.closurePercentage}
			FROM ${salesStages}
			WHERE ${salesStages.id} = ${effectiveStageId}
		), 0) < 80
		OR ${effectiveLeadId} IS NOT NULL
	)`;
}

export const WON_OPPORTUNITY_FROZEN_FIELD_LABELS = {
	vehicleId: "el vehículo",
	leadId: "el cliente",
	companyId: "la empresa",
	creditType: "el tipo de crédito",
} as const;

export type WonOpportunityFrozenField =
	keyof typeof WON_OPPORTUNITY_FROZEN_FIELD_LABELS;

export const WON_OPPORTUNITY_FROZEN_FIELDS = Object.keys(
	WON_OPPORTUNITY_FROZEN_FIELD_LABELS,
) as WonOpportunityFrozenField[];

/**
 * Campos de una oportunidad ganada que ya viajaron a los contratos y a
 * cartera: cambiarlos después deja al CRM diciendo algo distinto de lo que se
 * firmó (el caso de la opp ganada a la que le cambiaron el carro).
 *
 * Se congelan SOLO estos. Una oportunidad pasa a `won` en el 90%, y de ahí
 * todavía tiene que avanzar al 100% y recibir ajustes operativos (etapa,
 * dirección, notas, datos del crédito), así que bloquear el update completo
 * rompería ese tramo.
 *
 * Devuelve los campos congelados que el input REALMENTE cambiaría; comparar
 * contra el valor actual es lo que permite que la modal reenvíe el formulario
 * entero sin falsos positivos.
 */
export function getWonOpportunityFrozenFieldChanges(
	input: Partial<Record<WonOpportunityFrozenField, string | null | undefined>>,
	current: Partial<Record<WonOpportunityFrozenField, string | null>>,
): WonOpportunityFrozenField[] {
	return WON_OPPORTUNITY_FROZEN_FIELDS.filter((field) => {
		if (!(field in input)) return false;
		const next = input[field];
		if (next === undefined) return false;
		return (next ?? null) !== (current[field] ?? null);
	});
}

export function buildWonOpportunityFrozenFieldError(
	fields: WonOpportunityFrozenField[],
) {
	const labels = fields
		.map((field) => WON_OPPORTUNITY_FROZEN_FIELD_LABELS[field])
		.join(", ");
	return (
		`La oportunidad ya está ganada: no se puede cambiar ${labels} porque ` +
		"así viajó a los contratos y a cartera. Si hay que corregirlo, debe " +
		"hacerlo un administrador."
	);
}

/**
 * Mensaje de rechazo si el usuario no puede tocar los campos congelados de una
 * oportunidad ganada. `null` = puede seguir (no está ganada, es admin, o no
 * cambia ninguno de esos campos).
 */
export function getWonOpportunityLockError(
	status: string | null | undefined,
	role: string | null | undefined,
	frozenFieldChanges: WonOpportunityFrozenField[],
) {
	if (status !== "won") return null;
	if (PERMISSIONS.canAccessAdmin(role ?? "")) return null;
	if (frozenFieldChanges.length === 0) return null;
	return buildWonOpportunityFrozenFieldError(frozenFieldChanges);
}
