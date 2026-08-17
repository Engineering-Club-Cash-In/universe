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
	title: opportunities.title,
	notes: opportunities.notes,
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
 * Cualquier proceso vivo del lead, sin importar por qué canal se abrió.
 *
 * Es el mismo criterio que usa el bot de WhatsApp para respetar al asesor que
 * está atendiendo al cliente. Se devuelve el más reciente porque es el que
 * refleja lo que el cliente está pidiendo hoy.
 */
export async function getActiveOpportunity(leadId: string) {
	const [existing] = await db
		.select(activeOpportunityColumns)
		.from(opportunities)
		.where(
			and(
				eq(opportunities.leadId, leadId),
				inArray(opportunities.status, ACTIVE_OPPORTUNITY_STATUSES),
			),
		)
		.orderBy(desc(opportunities.createdAt))
		.limit(1);

	return existing;
}
