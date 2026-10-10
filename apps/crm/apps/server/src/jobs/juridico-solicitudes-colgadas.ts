/**
 * W3 · Job de cada 5 min: devuelve a error_aplicacion los escalados a Jurídico
 * aprobados que se quedaron en `aprobada` (se cayó el proceso antes de la
 * respuesta de cartera) y avisa a los supervisores para que los repitan. Mismo
 * criterio que las rebajas (jobs/rebajas-mora-colgadas.ts), mismo umbral.
 * Ver services/juridico-solicitud.ts (marcarEscalamientosColgados).
 */

import { UMBRAL_APROBACION_COLGADA_MS } from "../lib/rebaja-mora-reglas";
import { marcarEscalamientosColgados } from "../services/juridico-solicitud";

export async function correrJuridicoSolicitudesColgadas(): Promise<void> {
	try {
		const n = await marcarEscalamientosColgados(
			new Date(),
			UMBRAL_APROBACION_COLGADA_MS,
		);
		if (n > 0) {
			console.log(
				`[JuridicoSolicitudes] ${n} aprobación(es) interrumpida(s) pasaron a error_aplicacion`,
			);
		}
	} catch (error) {
		console.error("Error en el job de escalados a Jurídico colgados:", error);
	}
}
