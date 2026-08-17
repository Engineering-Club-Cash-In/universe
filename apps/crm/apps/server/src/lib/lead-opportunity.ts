import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { opportunities } from "../db/schema/crm";
import {
	buildOpenOpportunityBySourceCondition,
	type LeadSource,
} from "./lead-opportunity-source";

/** Estados que significan "el asesor todavía está trabajando este proceso". */
const ACTIVE_OPPORTUNITY_STATUSES = ["open", "on_hold"] as const;

const activeOpportunityColumns = {
	id: opportunities.id,
	assignedTo: opportunities.assignedTo,
	source: opportunities.source,
	campaign: opportunities.campaign,
	creditType: opportunities.creditType,
};

/**
 * Busca la oportunidad activa del lead que pertenezca al canal `source`.
 *
 * `leadSource` es el canal que el lead tenía ANTES de cualquier actualización
 * hecha en el mismo request; ver `buildOpenOpportunityBySourceCondition`.
 */
export async function getOpenOpportunityBySource(
	leadId: string,
	source: LeadSource,
	leadSource: LeadSource,
) {
	const [existing] = await db
		.select(activeOpportunityColumns)
		.from(opportunities)
		.where(buildOpenOpportunityBySourceCondition(leadId, source, leadSource))
		.orderBy(desc(opportunities.createdAt))
		.limit(1);

	return existing;
}

/**
 * Cualquier proceso vivo del cliente, sin importar por qué canal se abrió.
 *
 * Recibe todas las filas de lead que empataron con el cliente, no una sola:
 * mientras queden duplicados sin depurar, la oportunidad activa puede estar
 * colgada de cualquiera de ellas, y mirar solo una haría pasar por inactivo a
 * un cliente que otro asesor ya está atendiendo. Es el mismo criterio que usa
 * el bot de WhatsApp. Se devuelve la más reciente porque es la que refleja lo
 * que el cliente está pidiendo hoy.
 */
export async function getActiveOpportunity(leadIds: string[]) {
	if (leadIds.length === 0) {
		return undefined;
	}

	const [existing] = await db
		.select({ ...activeOpportunityColumns, leadId: opportunities.leadId })
		.from(opportunities)
		.where(
			and(
				inArray(opportunities.leadId, leadIds),
				inArray(opportunities.status, ACTIVE_OPPORTUNITY_STATUSES),
			),
		)
		.orderBy(desc(opportunities.createdAt))
		.limit(1);

	return existing;
}
