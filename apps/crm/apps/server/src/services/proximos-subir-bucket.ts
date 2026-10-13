/**
 * «Próximos a subir de bucket» de un asesor (tarea M2). Reglas puras en
 * lib/proximos-subir-bucket.ts; acá solo se trae de cartera lo necesario y se
 * quitan los que tienen una promesa vigente.
 */

import { fetchAllPages } from "../lib/fetch-all-pages";
import {
	bucketsQueSuben,
	conteoPorBucket,
	DIAS_VENTANA_SUBIR_BUCKET,
	proximosASubirBucket,
} from "../lib/proximos-subir-bucket";
import { carteraBackClient } from "./cartera-back-client";
import { sifcosConPromesaVigente } from "./promesas-vigentes-sifco";

export async function listarProximosSubirBucket(
	asesorId: number,
	ahora: Date = new Date(),
) {
	// Los rangos y los pisos por estado salen del catálogo vigente de cartera.
	const catalogo = await carteraBackClient.getBucketsCatalogo();
	const buckets = bucketsQueSuben(catalogo);
	const dias = Array.from(
		{ length: DIAS_VENTANA_SUBIR_BUCKET + 1 },
		(_, i) => i,
	);
	const cuotas = await fetchAllPages(
		async (page) => {
			const resp = await carteraBackClient.getCuotasProximasVencer(dias, {
				soloAlDia: false,
				buckets,
				asesorId,
				page,
				perPage: 200,
			});
			return { data: resp.data ?? [], totalPages: resp.totalPages ?? 0 };
		},
		{ maxPages: 50 },
	);
	const candidatos = proximosASubirBucket(cuotas, catalogo);
	const conPromesa = await sifcosConPromesaVigente(
		candidatos.map((c) => c.sifco),
		ahora,
	);
	const items = candidatos.filter((c) => !conPromesa.has(c.sifco));
	return {
		asesorId,
		ventanaDias: DIAS_VENTANA_SUBIR_BUCKET,
		total: items.length,
		porBucket: conteoPorBucket(items, buckets),
		items,
	};
}
