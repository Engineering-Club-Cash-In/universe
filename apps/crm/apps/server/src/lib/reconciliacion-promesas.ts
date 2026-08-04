/**
 * CB-030 — decisión pura de la reconciliación diaria de promesas de pago
 * (services/sync-promesas-cartera-back.ts).
 *
 * Vive acá, separada del job, porque la regla tiene un filo peligroso y
 * merece test propio: en modo "reconciliacion_completa" un batch vacío NO
 * significa "no hagas nada" — significa "desactivá todo el espejo". Eso es
 * exactamente lo que se quiere cuando de verdad no hay promesas vigentes
 * hoy (es la única forma de limpiar la última fila si su push de resolución
 * se perdió), y exactamente lo que NO se quiere cuando había promesas pero
 * ninguna resolvió a un caso con SIFCO: ahí el batch vacío es un síntoma de
 * drift de datos, y enviarlo destrabaría el freeze de créditos cuya promesa
 * sigue vigente.
 *
 * Ante la duda, freeze stale (visible, se autodestraba solo por
 * fecha_promesa < hoy) antes que unfreeze masivo silencioso.
 */

export type DecisionReconciliacion =
	| { enviar: true }
	| { enviar: false; motivo: "drift_sin_sifco" };

/**
 * @param totalPromesasVigentes filas de promesa vigentes leídas de la DB del CRM
 * @param totalPayload cuántas de esas resolvieron a un caso con numeroCreditoSifco
 */
export function decidirEnvioReconciliacion(
	totalPromesasVigentes: number,
	totalPayload: number,
): DecisionReconciliacion {
	// Payload con contenido → siempre se envía.
	if (totalPayload > 0) return { enviar: true };
	// Payload vacío porque no hay NADA vigente hoy → se envía (limpia el espejo).
	if (totalPromesasVigentes === 0) return { enviar: true };
	// Payload vacío pero SÍ había promesas vigentes → drift, no se envía.
	return { enviar: false, motivo: "drift_sin_sifco" };
}
