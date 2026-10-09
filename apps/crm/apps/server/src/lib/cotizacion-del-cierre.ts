import { db } from "../db";
import { opportunityCloseQuotations } from "../db/schema/quotations";

/**
 * Guarda la cotización con la que el cierre armó el crédito. Nunca lanza: va
 * después de la transacción del cierre (el crédito en cartera ya existe) y no
 * puede tumbarlo. Si no se guarda, la factura del seguro reconstruye la
 * cotización como antes.
 */
export async function guardarCotizacionDelCierre(
	opportunityId: string,
	quotationId: string,
	conexion: Pick<typeof db, "insert"> = db,
): Promise<void> {
	try {
		await conexion
			.insert(opportunityCloseQuotations)
			.values({ opportunityId, quotationId })
			.onConflictDoUpdate({
				target: opportunityCloseQuotations.opportunityId,
				set: { quotationId, createdAt: new Date() },
			});
	} catch (error) {
		console.warn(
			"[CloseOpportunity] No se pudo guardar la cotización del cierre",
			{ opportunityId, quotationId },
			error,
		);
	}
}
