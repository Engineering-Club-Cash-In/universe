/**
 * W2 · Job de cada 5 min: devuelve a `error_aplicacion` las rebajas de mora
 * aprobadas que se quedaron en `aprobada` (se cayó el proceso antes de la
 * respuesta de cartera) y avisa a los supervisores para que las repitan.
 * Ver services/rebaja-mora.ts (marcarAprobacionesColgadas).
 */

import { UMBRAL_APROBACION_COLGADA_MS } from "../lib/rebaja-mora-reglas";
import { marcarAprobacionesColgadas } from "../services/rebaja-mora";

export async function correrRebajasMoraColgadas(): Promise<void> {
	try {
		const n = await marcarAprobacionesColgadas(
			new Date(),
			UMBRAL_APROBACION_COLGADA_MS,
		);
		if (n > 0) {
			console.log(
				`[RebajasMora] ${n} aprobación(es) interrumpida(s) pasaron a error_aplicacion`,
			);
		}
	} catch (error) {
		console.error("Error en el job de rebajas de mora colgadas:", error);
	}
}
