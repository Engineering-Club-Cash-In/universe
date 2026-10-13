/**
 * SIFCOs (de un conjunto) que tienen una promesa de pago vigente en su caso
 * vigente. Lo comparten «Listos para Prejurídico» (S1) y «Próximos a subir de
 * bucket» (M2): la promesa congela la cuota y saca al crédito de ambos.
 */

import { and, inArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
import { esPromesaVigente } from "../lib/promesa-vigente";

export async function sifcosConPromesaVigente(
	sifcos: readonly string[],
	ahora: Date,
): Promise<Set<string>> {
	if (sifcos.length === 0) return new Set();
	// Solo el caso vigente de cada SIFCO: una promesa olvidada en un caso viejo
	// (reaperturas, migraciones) no debe sacar al crédito de la lista.
	const casos = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, [...sifcos]));
	const vigentes = [...agruparCasosVigentesPorSifco(casos).values()];
	if (vigentes.length === 0) return new Set();
	const sifcoPorCaso = new Map(
		vigentes.map((c) => [c.id, c.numeroCreditoSifco]),
	);
	const conPromesa = await db
		.selectDistinct({ casoCobroId: contactosCobros.casoCobroId })
		.from(contactosCobros)
		.where(
			and(
				inArray(
					contactosCobros.casoCobroId,
					vigentes.map((c) => c.id),
				),
				esPromesaVigente(ahora),
			),
		);
	return new Set(
		conPromesa.flatMap((f) => {
			const sifco = sifcoPorCaso.get(f.casoCobroId);
			return sifco ? [sifco] : [];
		}),
	);
}
