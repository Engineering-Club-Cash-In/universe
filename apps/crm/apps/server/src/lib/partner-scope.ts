import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import { opportunities } from "../db/schema/crm";
import {
	opportunityAgencySellers,
	partnerMembers,
} from "../db/schema/partners";

// `sellerId` null = gerente: ve toda la agencia. Con vendedor, solo lo suyo.
export type MembresiaSocio = { companyId: string; sellerId: string | null };

// Única fuente de verdad del alcance de un socio.
export async function resolvePartnerScope(
	userId: string,
	conexion: Pick<typeof db, "select"> = db,
): Promise<MembresiaSocio[]> {
	const rows = await conexion
		.select({
			companyId: partnerMembers.companyId,
			sellerId: partnerMembers.sellerId,
		})
		.from(partnerMembers)
		.where(eq(partnerMembers.userId, userId));

	return rows.map((row) => ({
		companyId: row.companyId,
		sellerId: row.sellerId ?? null,
	}));
}

// Requiere que la query tenga left join a `opportunity_agency_sellers`.
export function condicionDeAlcance(membresias: MembresiaSocio[]): SQL {
	if (membresias.length === 0) return sql`false`;

	const condiciones = membresias.map((m) =>
		m.sellerId
			? (and(
					eq(opportunities.companyId, m.companyId),
					eq(opportunityAgencySellers.sellerId, m.sellerId),
				) as SQL)
			: eq(opportunities.companyId, m.companyId),
	);
	return or(...condiciones) as SQL;
}

export function casoDentroDeAlcance(
	caso: { companyId: string | null; sellerId: string | null },
	membresias: MembresiaSocio[],
): boolean {
	if (!caso.companyId) return false;
	return membresias.some(
		(m) =>
			m.companyId === caso.companyId &&
			(m.sellerId === null || m.sellerId === caso.sellerId),
	);
}
