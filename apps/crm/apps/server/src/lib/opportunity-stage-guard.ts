import { sql } from "drizzle-orm";
import { opportunities, salesStages } from "../db/schema";

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
