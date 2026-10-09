import { ORPCError } from "@orpc/server";
import { sql } from "drizzle-orm";
import type { db } from "../db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Evita ocupar el pool mientras Infornet retiene el candado de la oportunidad. */
export async function tomarCandadoBuroSiLibre(
	tx: Transaction,
	opportunityId: string,
): Promise<void> {
	const resultado = await tx.execute<{ tomado: boolean }>(
		sql`select pg_try_advisory_xact_lock(hashtext(${opportunityId})) as tomado`,
	);
	if (resultado.rows[0]?.tomado !== true) {
		throw new ORPCError("CONFLICT", {
			message:
				"La consulta de Buró sigue en curso. Espera el resultado e intenta de nuevo.",
		});
	}
}
