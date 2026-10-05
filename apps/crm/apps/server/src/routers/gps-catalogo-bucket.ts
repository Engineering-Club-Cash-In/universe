/**
 * Bucket de los créditos del catálogo de unidades GPS (/admin/gps), para poder
 * filtrar por bucket. Router aparte: el tipo combinado de routers está en el
 * límite donde TS7056 trunca lo inferido en el web (ver
 * mis-pendientes-inmovilizacion.ts).
 *
 * El bucket sale SIEMPRE del motor de cartera-back (`/buckets/bucket-por-sifco`,
 * misma derivación que el badge de la Ficha 360), no de `casos_cobros.estado_mora`:
 * esa copia local solo mira cuotas atrasadas y se actualiza al sincronizar, así
 * que puede decir otro bucket que la ficha. Va en bulk (hasta 1000 SIFCOs por
 * llamada, en tandas) para que escale con toda la flota.
 */

import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { estadoMoraPorNumeroBucket } from "../lib/moraBuckets";
import { adminProcedure } from "../lib/orpc";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";

/** Tope que cartera-back acepta por llamada (`/buckets/bucket-por-sifco`). */
const SIFCOS_POR_LLAMADA = 1000;

export const gpsCatalogoBucketRouter = {
	getEstadoMoraPorSifco: adminProcedure
		// Sin tope: la página manda los SIFCOs de todo el catálogo de Wialon en una
		// sola solicitud y este procedimiento ya los parte en tandas de
		// SIFCOS_POR_LLAMADA; un máximo acá dejaría sin filtro a una flota grande.
		.input(z.object({ sifcos: z.array(z.string().min(1)) }))
		.handler(
			async ({
				input,
			}): Promise<{ estadoMoraPorSifco: Record<string, string> }> => {
				const sifcos = [...new Set(input.sifcos)];
				if (sifcos.length === 0) return { estadoMoraPorSifco: {} };

				if (!isCarteraBackEnabled()) {
					throw new ORPCError("SERVICE_UNAVAILABLE", {
						message:
							"La integración con cartera-back está apagada: no se puede consultar el bucket de los créditos.",
					});
				}

				const estadoMoraPorSifco: Record<string, string> = {};
				try {
					// En tandas y en serie: cada una es una sola consulta SQL en
					// cartera-back, y no hay motivo para abrir N llamadas a la vez.
					for (let i = 0; i < sifcos.length; i += SIFCOS_POR_LLAMADA) {
						const { data } = await carteraBackClient.getBucketPorSifco({
							sifcos: sifcos.slice(i, i + SIFCOS_POR_LLAMADA),
						});
						for (const f of data) {
							// Sin bucket (fuera del funnel o no resoluble) = sin entrada:
							// no se inventa uno.
							if (f.bucket == null) continue;
							const estado =
								f.estado_mora ?? estadoMoraPorNumeroBucket(f.bucket);
							if (estado) estadoMoraPorSifco[f.numero_credito_sifco] = estado;
						}
					}
				} catch (error) {
					console.error("[getEstadoMoraPorSifco] cartera-back:", error);
					throw new ORPCError("SERVICE_UNAVAILABLE", {
						message:
							"No se pudo consultar el bucket de los créditos en cartera-back. Intente de nuevo en unos minutos.",
					});
				}
				return { estadoMoraPorSifco };
			},
		),
};
