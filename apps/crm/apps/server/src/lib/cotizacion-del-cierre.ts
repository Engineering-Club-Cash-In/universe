import type { db } from "../db";
import { opportunityCloseQuotations } from "../db/schema/quotations";

/**
 * Guarda la cotización con la que el cierre armó el crédito, dentro de la
 * transacción que lo marca ganado. Nunca lanza: va en un savepoint, así que si
 * falla solo se descarta este registro y el cierre sigue (el crédito en cartera
 * ya existe). Sin registro, la factura del vehículo reconstruye la cotización.
 */
export async function guardarCotizacionDelCierre(
	opportunityId: string,
	quotationId: string,
	tx: Pick<typeof db, "transaction">,
): Promise<void> {
	try {
		await tx.transaction(async (savepoint) => {
			await savepoint
				.insert(opportunityCloseQuotations)
				.values({ opportunityId, quotationId })
				.onConflictDoUpdate({
					target: opportunityCloseQuotations.opportunityId,
					set: { quotationId, createdAt: new Date() },
				});
		});
	} catch (error) {
		console.warn(
			"[CloseOpportunity] No se pudo guardar la cotización del cierre",
			{ opportunityId, quotationId },
			error,
		);
	}
}
