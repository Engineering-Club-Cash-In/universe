import { sql } from "drizzle-orm";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";

/**
 * CTE: estado de mora por crédito "as-of" `fecha` (día de Guatemala).
 *
 * `monto`/`tipo_evento`/`fecha` salen del ÚLTIMO evento; `cuotas` sale del
 * último evento CON cuotas>0 (carry-forward).
 *
 * Antes esto eran dos window functions (`ROW_NUMBER` + `FIRST_VALUE`) sobre un
 * filtro no sargable, así que cada llamada ordenaba el historial ENTERO: con
 * 21.892 filas el plan ya gastaba 2,3 MB de sort contra un `work_mem` de 4 MB.
 * Con la mora proporcional el cron escribe un `RECALCULO` por crédito por noche
 * (~1.500 filas/día en vez de ~313), así que ese sort cruzaba `work_mem` en un
 * par de semanas y se iba a disco de golpe —un escalón, no una curva—. Ahora
 * son dos `DISTINCT ON` que caminan índices ya ordenados: Index Only Scan +
 * Unique, cero sorts y cero heap fetches.
 */
export const snapCte = (fecha: string, incluirFecha = true) => {
	// `moras_historial.fecha` es `timestamp` SIN zona con el instante en UTC. El
	// corte es por DÍA de Guatemala (el cron corre ~23:59 GT, o sea ~06:00 UTC del
	// día siguiente: comparar en UTC pelado correría esos eventos un día).
	// Envolver la columna —`(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE
	// 'America/Guatemala')::date`— daba el día correcto pero inutilizaba todo
	// índice sobre `fecha`. La operación inversa da el mismo conjunto y es
	// sargable: se convierte el LÍMITE del día GT a instante UTC y se compara
	// contra la columna CRUDA. Mismo criterio que `moraRecuperacion.ts`.
	//
	// Siempre es un `<` contra la medianoche GT: "al día X inclusive" es
	// "< medianoche del X+1", y "antes del día X" es "< medianoche del X".
	const limiteUtc = inicioDiaGTComoTimestampUTC(fecha, incluirFecha ? 1 : 0);
	if (!limiteUtc) {
		throw new RangeError(`Fecha de snapshot de mora inválida: ${fecha}`);
	}
	const corte = sql`h.fecha < ${limiteUtc}::timestamp`;

	return sql`
  snap_ultimo AS (
    SELECT DISTINCT ON (h.credito_id)
      h.credito_id,
      h.tipo_evento,
      h.monto_nuevo::numeric AS monto,
      h.fecha,
      h.cuotas_atrasadas_nuevas AS cuotas_ultimo
    FROM cartera.moras_historial h
    WHERE ${corte}
    -- La columna fecha la escribe registrarHistorialMora (latefee.ts) con
    -- clock_timestamp()::timestamp: la hora REAL del insert, no la del BEGIN. Con el
    -- DEFAULT now() —que es transaction_timestamp()— una transacción larga (el convenio)
    -- fechaba su evento con la hora en que arrancó, y un ajuste de mora commiteado en el
    -- medio quedaba "después": este ORDER BY fecha DESC lo elegía y el reporte mostraba
    -- mora activa después de que el convenio la desactivó. El desempate por
    -- historial_id DESC sigue haciendo falta para eventos que caen en la misma marca.
    ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
  ),
  snap_cuotas AS (
    -- Cuotas "vivas": las del evento más reciente con cuotas>0. Los eventos
    -- payment-only (updateMora sin cuotas, p.ej. la reversa de pago de
    -- reversePayment.ts) registran cuotas_atrasadas_nuevas=0; sin este
    -- carry-forward un crédito con mora>0 cuyo último evento sea payment-only
    -- caería a "Al día" y se saldría de los buckets 30/60/90/120 (review Codex).
    -- En el dump local esto NO es teórico: 603 de 1.321 créditos dependen de él.
    SELECT DISTINCT ON (h.credito_id)
      h.credito_id,
      h.cuotas_atrasadas_nuevas AS cuotas
    FROM cartera.moras_historial h
    WHERE ${corte}
      AND h.cuotas_atrasadas_nuevas > 0
    ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
  ),
  snap AS (
    -- LEFT JOIN y no INNER: un crédito sin ningún evento con cuotas>0 tiene que
    -- seguir apareciendo. El COALESCE cae a las cuotas del último evento —no a
    -- un 0 literal— para que el resultado sea idéntico al FIRST_VALUE anterior
    -- incluso si algún día entrara un valor negativo.
    SELECT
      u.credito_id,
      u.tipo_evento,
      u.monto,
      COALESCE(k.cuotas, u.cuotas_ultimo) AS cuotas,
      u.fecha
    FROM snap_ultimo u
    LEFT JOIN snap_cuotas k ON k.credito_id = u.credito_id
  )`;
};
