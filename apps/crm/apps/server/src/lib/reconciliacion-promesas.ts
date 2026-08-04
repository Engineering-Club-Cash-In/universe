/**
 * CB-030 — decisión pura de la reconciliación diaria de promesas de pago
 * (services/sync-promesas-cartera-back.ts).
 *
 * Vive acá, separada del job, porque la regla tiene un filo peligroso y
 * merece test propio: en modo "reconciliacion_completa" el batch se declara
 * como el 100% de lo vigente, y cartera-back DESACTIVA toda fila activa
 * ausente de él. Eso es exactamente lo que se quiere para limpiar promesas
 * ya resueltas cuyo push se perdió, y exactamente lo que NO se quiere
 * cuando el batch está incompleto por un problema de datos: ahí las filas
 * ausentes corresponden a promesas TODAVÍA VIGENTES, y desactivarlas las
 * destraba justo antes de que corra procesarMoras.
 *
 * Ante la duda, freeze stale (visible, se autodestraba solo por
 * fecha_promesa < hoy) antes que unfreeze incorrecto y silencioso.
 */

export type DecisionReconciliacion =
	/** Batch completo y confiable: se declara como el set total de lo vigente. */
	| { enviar: true; modo: "reconciliacion_completa" }
	/**
	 * Batch incompleto (alguna promesa vigente no resolvió a un caso con
	 * SIFCO). Se envía igual para no perder el upsert de las que sí
	 * resolvieron, pero degradado a "evento" para que cartera-back NO
	 * desactive nada — las filas ausentes del batch no son promesas
	 * resueltas, son promesas que no supimos resolver.
	 */
	| { enviar: true; modo: "evento"; motivo: "drift_parcial" }
	/** Nada que enviar y nada que declarar: enviar [] apagaría todo el espejo. */
	| { enviar: false; motivo: "drift_sin_sifco" };

/**
 * @param totalPromesasVigentes filas de promesa vigentes leídas de la DB del CRM
 * @param totalPayload cuántas de esas resolvieron a un caso con numeroCreditoSifco
 */
export function decidirEnvioReconciliacion(
	totalPromesasVigentes: number,
	totalPayload: number,
): DecisionReconciliacion {
	const sinResolver = totalPromesasVigentes - totalPayload;

	// Nada vigente hoy → batch vacío declarado como completo. Es la ÚNICA
	// forma de desactivar la última fila del espejo si su push se perdió.
	if (totalPromesasVigentes === 0) {
		return { enviar: true, modo: "reconciliacion_completa" };
	}

	// Había promesas vigentes y NINGUNA resolvió → no se envía. Un [] acá
	// sería indistinguible de "no hay nada vigente" y apagaría todo.
	if (totalPayload === 0) {
		return { enviar: false, motivo: "drift_sin_sifco" };
	}

	// Batch parcial → se envía lo resuelto, pero sin declararlo completo: las
	// ausentes siguen vigentes, desactivarlas destrabaría su freeze.
	if (sinResolver > 0) {
		return { enviar: true, modo: "evento", motivo: "drift_parcial" };
	}

	// Todas resolvieron → el batch sí es el set completo.
	return { enviar: true, modo: "reconciliacion_completa" };
}
