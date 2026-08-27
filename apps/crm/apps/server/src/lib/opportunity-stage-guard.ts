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

/**
 * Datos de una oportunidad ganada que ya viajaron a los contratos y a cartera.
 * Cambiarlos después deja al CRM diciendo algo distinto de lo que se firmó.
 *
 * Se congelan SOLO estos. Una oportunidad pasa a `won` en el 90% y de ahí
 * todavía avanza al 100% con ajustes operativos (etapa, dirección, datos del
 * crédito), así que congelar el update entero rompería ese tramo.
 *
 * `status` está en la lista para que no se pueda despegar de "won": sin eso,
 * reabrirla en un request y cambiarle el vehículo en el siguiente esquiva todo
 * lo demás.
 */
export const WON_OPPORTUNITY_FROZEN_FIELD_LABELS = {
	vehicleId: "el vehículo",
	leadId: "el cliente",
	companyId: "la empresa",
	creditType: "el tipo de crédito",
	status: "el estado",
} as const;

export type WonOpportunityFrozenField =
	keyof typeof WON_OPPORTUNITY_FROZEN_FIELD_LABELS;

export const WON_OPPORTUNITY_FROZEN_FIELDS = Object.keys(
	WON_OPPORTUNITY_FROZEN_FIELD_LABELS,
) as WonOpportunityFrozenField[];

type FrozenValues = Partial<
	Record<WonOpportunityFrozenField, string | null | undefined>
>;

/**
 * Campos congelados que el input REALMENTE cambiaría. Comparar contra el valor
 * actual es lo que permite que la modal reenvíe el formulario entero sin
 * falsos positivos.
 */
export function getWonOpportunityFrozenFieldChanges(
	input: FrozenValues,
	current: FrozenValues,
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
		`La oportunidad ya está ganada: no se puede cambiar ${labels}; así se ` +
		"firmaron los contratos y así viajó a cartera. Si hay que corregirlo, " +
		"debe hacerlo un administrador."
	);
}

/**
 * Mensaje de rechazo, o `null` si puede seguir (no está ganada, es admin, o no
 * toca ninguno de los campos congelados).
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

/**
 * Saca del UPDATE los campos congelados que no cambian respecto de la lectura
 * previa.
 *
 * Sin esto, el formulario reenvía el valor viejo y lo vuelve a escribir: si un
 * admin corrigió el vehículo entre el SELECT y el UPDATE, el guardado de otro
 * usuario le pisa la corrección con un dato que ya era viejo cuando se leyó.
 * No escribir lo que no cambió es más simple que defenderlo en el predicado.
 */
export function stripUnchangedFrozenFields<T extends FrozenValues>(
	updateData: T,
	current: FrozenValues,
): Partial<T> {
	const out = { ...updateData };
	for (const field of WON_OPPORTUNITY_FROZEN_FIELDS) {
		if (!(field in out)) continue;
		const next = out[field];
		if (next === undefined) continue;
		if ((next ?? null) === (current[field] ?? null)) delete out[field];
	}
	return out;
}

export const WON_OPPORTUNITY_REVOKE_ERROR =
	"La oportunidad ya está ganada: no se puede cancelar la aprobación del " +
	"detalle de crédito porque el crédito ya existe en cartera.";

/**
 * Cancelar la aprobación del detalle devuelve la oportunidad al 40% y deja el
 * detalle editable otra vez. Sobre una oportunidad ganada eso es una puerta
 * trasera al congelamiento: cancelar, editar, volver a aprobar.
 *
 * Ya existe un guard por etapa (>= 90% no se puede cancelar), pero mira la
 * etapa y no el estado: `confirmContractsSigned` crea el crédito en cartera y
 * recién después mueve la etapa, así que si eso falla la oportunidad queda
 * ganada en el 85% y el guard por etapa la deja pasar.
 */
export function getWonOpportunityRevokeError(
	status: string | null | undefined,
) {
	return status === "won" ? WON_OPPORTUNITY_REVOKE_ERROR : null;
}
