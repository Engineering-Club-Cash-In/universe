import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { type leadSourceEnum, opportunities } from "../db/schema/crm";

export type LeadSource = (typeof leadSourceEnum.enumValues)[number];

/**
 * Condición que decide qué oportunidad activa del lead pertenece al canal
 * `source`.
 *
 * Las oportunidades legacy quedaron sin `source`; se consideran del canal del
 * lead. Ese canal se recibe por parámetro (`leadSource`) y a propósito no se
 * consulta contra la tabla `leads`: `createPublicLead` actualiza `leads.source`
 * al canal recién pedido dentro del mismo request, así que leerlo desde la
 * query daría siempre el canal nuevo y haría pasar cualquier oportunidad legacy
 * —incluso la de otro canal— por una del canal correcto. El caller debe pasar
 * el valor que el lead tenía antes de esa actualización.
 *
 * Vive en su propio módulo, sin tocar `db`, para poder verificarlo en tests sin
 * depender de mocks de módulo (que en bun son globales entre archivos).
 */
export function buildOpenOpportunityBySourceCondition(
	leadId: string,
	source: LeadSource,
	leadSource: LeadSource,
): SQL | undefined {
	const legacyBelongsToSource = leadSource === source;

	return and(
		eq(opportunities.leadId, leadId),
		legacyBelongsToSource
			? or(eq(opportunities.source, source), isNull(opportunities.source))
			: eq(opportunities.source, source),
		or(eq(opportunities.status, "open"), eq(opportunities.status, "on_hold")),
	);
}
