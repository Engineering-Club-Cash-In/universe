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
 * Los procesos vivos del cliente, sin importar por qué canal se abrieron, de la
 * más reciente a la más vieja.
 *
 * Recibe todas las filas de lead que empataron con el cliente, no una sola:
 * mientras queden duplicados sin depurar, las oportunidades activas pueden
 * estar repartidas entre varias filas, y mirar solo una haría pasar por
 * inactivo a un cliente que otro asesor ya está atendiendo. Es el mismo
 * criterio que usa el bot de WhatsApp.
 *
 * Se devuelven todas y no la primera porque quien llama necesita dos cosas
 * distintas: la más reciente, que es la que refleja lo que el cliente pide hoy,
 * y la del canal por el que acaba de entrar, que puede ser otra.
 */
export async function getActiveOpportunities(leadIds: string[]) {
	if (leadIds.length === 0) {
		return [];
	}

	return db
		.select({ ...activeOpportunityColumns, leadId: opportunities.leadId })
		.from(opportunities)
		.where(
			and(
				inArray(opportunities.leadId, leadIds),
				inArray(opportunities.status, ACTIVE_OPPORTUNITY_STATUSES),
			),
		)
		.orderBy(desc(opportunities.createdAt));
}
