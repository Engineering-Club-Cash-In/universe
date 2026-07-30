import { eq } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resuelve un `creditoId` de entrada (número SIFCO o UUID de caso, según de
 * dónde venga el link — notificaciones mandan el UUID, el resto de la app
 * manda el SIFCO) al número SIFCO real. Si ya es SIFCO, se devuelve tal cual.
 *
 * Único lugar de esta resolución: antes vivía duplicada verbatim en
 * getDetallesCreditoCarteraBack y en getBucketActualCredito — un fix en una
 * copia podía olvidarse en la otra.
 */
export async function resolverNumeroSifco(
	creditoId: string,
): Promise<string | null> {
	if (!UUID_REGEX.test(creditoId)) return creditoId;

	const [caso] = await db
		.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, creditoId))
		.limit(1);

	return caso?.numeroCreditoSifco ?? null;
}
