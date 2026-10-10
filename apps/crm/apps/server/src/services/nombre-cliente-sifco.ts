/**
 * Nombre del cliente de cada crédito, por SIFCO, para las bandejas de cobros
 * (H5 de la revisión: la bandeja solo mostraba el número de crédito).
 *
 * Mismo criterio que el recordatorio de Pagalo (jobs/pagalo-reminder.ts): la
 * oportunidad más reciente del crédito que sigue vivo (ganada o migrada) y su
 * lead. No sale de `clients.contact_person`, que es otra fuente.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { armarNombreCliente } from "../lib/nombre-cliente";

// Mismo criterio que ESTADOS_OPORTUNIDAD_CON_CREDITO en jobs/pagalo-reminder.ts.
const ESTADOS_CON_CREDITO = ["won", "migrate"] as const;

/** Mapa SIFCO → nombre. Un SIFCO sin oportunidad con crédito no aparece. */
export async function nombresClientePorSifco(
	sifcos: string[],
): Promise<Map<string, string>> {
	const nombres = new Map<string, string>();
	const unicos = [...new Set(sifcos)];
	if (unicos.length === 0) return nombres;

	const filas = await db
		.select({
			numeroSifco: opportunities.numeroSifco,
			firstName: leads.firstName,
			middleName: leads.middleName,
			lastName: leads.lastName,
			secondLastName: leads.secondLastName,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(
			and(
				inArray(opportunities.numeroSifco, unicos),
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.orderBy(desc(opportunities.updatedAt));

	for (const fila of filas) {
		if (!fila.numeroSifco || nombres.has(fila.numeroSifco)) continue;
		const nombre = armarNombreCliente(fila);
		if (nombre) nombres.set(fila.numeroSifco, nombre);
	}
	return nombres;
}
