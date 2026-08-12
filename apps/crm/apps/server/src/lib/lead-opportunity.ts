import { desc } from "drizzle-orm";
import { db } from "../db";
import { opportunities } from "../db/schema/crm";
import {
	buildOpenOpportunityBySourceCondition,
	type LeadSource,
} from "./lead-opportunity-source";

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
		.select({
			id: opportunities.id,
			assignedTo: opportunities.assignedTo,
			source: opportunities.source,
			campaign: opportunities.campaign,
			creditType: opportunities.creditType,
		})
		.from(opportunities)
		.where(buildOpenOpportunityBySourceCondition(leadId, source, leadSource))
		.orderBy(desc(opportunities.createdAt))
		.limit(1);

	return existing;
}
