import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../db";
import { type leadSourceEnum, opportunities } from "../db/schema/crm";

type LeadSource = (typeof leadSourceEnum.enumValues)[number];

export async function getOpenOpportunityBySource(
	leadId: string,
	_source: LeadSource,
) {
	const [existing] = await db
		.select({
			id: opportunities.id,
			source: opportunities.source,
			campaign: opportunities.campaign,
			creditType: opportunities.creditType,
		})
		.from(opportunities)
		.where(
			and(
				eq(opportunities.leadId, leadId),
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
