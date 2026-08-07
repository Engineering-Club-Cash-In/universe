import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { type leadSourceEnum, leads, opportunities } from "../db/schema/crm";

type LeadSource = (typeof leadSourceEnum.enumValues)[number];

export async function getOpenOpportunityBySource(
	leadId: string,
	source: LeadSource,
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
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(
			and(
				eq(opportunities.leadId, leadId),
				or(
					eq(opportunities.source, source),
					and(isNull(opportunities.source), eq(leads.source, source)),
				),
				or(
					eq(opportunities.status, "open"),
					eq(opportunities.status, "on_hold"),
				),
			),
		)
		.orderBy(desc(opportunities.createdAt))
		.limit(1);

	return existing;
}
