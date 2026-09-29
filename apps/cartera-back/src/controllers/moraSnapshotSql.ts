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
 *
 * `creditos` acota la foto a ESOS créditos. Es OPCIONAL y sin él la CTE se
 * comporta exactamente como antes —la cartera entera—, que es lo que siguen
 * necesitando `moraHistorial.ts` y el reporte por etapa de `reportes.ts`.
 * Existe por el reporte de recuperación, que corre POR LOTES de 500 créditos:
 * el lote acotaba `creditos_con_asesor` pero no esta CTE, así que cada lote
 * reconstruía la foto de la cartera COMPLETA y recién descartaba los créditos
 * ajenos en el join final. Con el historial creciendo ~1.500 filas diarias eso
 * convierte el batching en trabajo casi cuadrático: más lotes, y cada uno
 * pagando la foto entera.
 *
 * CON lote la consulta NO es el mismo `DISTINCT ON` con un `WHERE credito_id =
 * ANY (...)` agregado, y no por gusto: MEDIDO contra el dump inflado a 164.000
 * filas, esa forma hace que el planner abandone el índice y resuelva con
 * `Seq Scan` + `Sort` externo A DISCO (1.704 kB) —exactamente el modo de falla
 * que la 0041 existe para eliminar—. Con 500 créditos el estimador cree que va
 * a tocar media tabla, y el barrido secuencial le "sale más barato" que 500
 * descensos de índice.
 *
 * Con la lista en la mano la forma correcta es un LATERAL por crédito: un
 * `ORDER BY … LIMIT 1` por cada uno, que es un descenso de índice que devuelve
 * UNA fila y no ordena nada. El costo pasa a ser proporcional al LOTE y deja de
 * depender del tamaño del historial, que es justo lo que el batching prometía.
 * `DISTINCT ON` sigue siendo lo correcto SIN lote: ahí no hay lista que
 * recorrer y el barrido ordenado del índice es lo más barato que hay.
 *
 * Las dos formas dan lo mismo por construcción: `DISTINCT ON (credito_id)
 * ORDER BY credito_id, fecha DESC, historial_id DESC` es "la primera fila de
 * cada crédito en ese orden", y el LATERAL pide esa misma primera fila crédito
 * por crédito. Un crédito sin filas no aparece en ninguna de las dos (el
 * LATERAL es CROSS, no LEFT). La equivalencia fila por fila contra el dump
 * está probada en el test.
 *
 * Lista VACÍA: se trata como "sin filtro" y no como "ningún crédito". Los
 * llamadores que baten en lotes nunca mandan un lote vacío (`partirEnLotes` no
 * los produce), y así el parámetro no puede convertir por accidente un reporte
 * completo en uno vacío.
 */
export const snapCte = (
	fecha: string,
	incluirFecha = true,
	creditos?: number[],
) => {
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

	// EL COMENTARIO DE LA FECHA, que vale para las dos formas: la columna la
	// escribe `registrarHistorialMora` (latefee.ts) con `clock_timestamp()`, o
	// sea la hora REAL del insert y no la del BEGIN. Con el DEFAULT `now()` —que
	// es `transaction_timestamp()`— una transacción larga (el convenio) fechaba
	// su evento con la hora en que arrancó, y un ajuste de mora commiteado en el
	// medio quedaba "después": el `ORDER BY fecha DESC` lo elegía y el reporte
	// mostraba mora activa después de que el convenio la desactivó. El desempate
	// por `historial_id DESC` sigue haciendo falta para los eventos que caen en
	// la misma marca.
	const masReciente = sql`ORDER BY h.fecha DESC, h.historial_id DESC`;

	// Cuotas "vivas": las del evento más reciente con cuotas>0. Los eventos
	// payment-only (updateMora sin cuotas, p.ej. la reversa de pago de
	// reversePayment.ts) registran cuotas_atrasadas_nuevas=0; sin este
	// carry-forward un crédito con mora>0 cuyo último evento sea payment-only
	// caería a "Al día" y se saldría de los buckets 30/60/90/120 (review Codex).
	// En el dump local esto NO es teórico: 603 de 1.321 créditos dependen de él.
	const soloConCuotas = sql`AND h.cuotas_atrasadas_nuevas > 0`;

	// El `snap` final es el mismo en las dos formas. LEFT JOIN y no INNER: un
	// crédito sin ningún evento con cuotas>0 tiene que seguir apareciendo. El
	// COALESCE cae a las cuotas del último evento —no a un 0 literal— para que
	// el resultado sea idéntico al FIRST_VALUE anterior incluso si algún día
	// entrara un valor negativo.
	const snapFinal = sql`
  snap AS (
    SELECT
      u.credito_id,
      u.tipo_evento,
      u.monto,
      COALESCE(k.cuotas, u.cuotas_ultimo) AS cuotas,
      u.fecha
    FROM snap_ultimo u
    LEFT JOIN snap_cuotas k ON k.credito_id = u.credito_id
  )`;

	// DE-DUPLICA: el LATERAL emite una fila por ENTRADA de la lista, así que un
	// id repetido duplicaría el crédito en `snap` y lo contaría dos veces. El
	// `DISTINCT ON` no podía tener ese problema. Hoy ningún llamador manda
	// repetidos (la lista sale de una PK), pero el parámetro es público.
	const ids = creditos?.length ? [...new Set(creditos)] : undefined;

	if (ids) {
		const lote = sql`ARRAY[${sql.join(
			ids.map((id) => sql`${id}`),
			sql`, `,
		)}]::int[]`;
		return sql`
  snap_ultimo AS (
    SELECT l.credito_id, u.tipo_evento, u.monto, u.fecha, u.cuotas_ultimo
    FROM unnest(${lote}) AS l(credito_id)
    CROSS JOIN LATERAL (
      SELECT
        h.tipo_evento,
        h.monto_nuevo::numeric AS monto,
        h.fecha,
        h.cuotas_atrasadas_nuevas AS cuotas_ultimo
      FROM cartera.moras_historial h
      WHERE h.credito_id = l.credito_id
        AND ${corte}
      ${masReciente}
      LIMIT 1
    ) u
  ),
  snap_cuotas AS (
    SELECT l.credito_id, k.cuotas
    FROM unnest(${lote}) AS l(credito_id)
    CROSS JOIN LATERAL (
      SELECT h.cuotas_atrasadas_nuevas AS cuotas
      FROM cartera.moras_historial h
      WHERE h.credito_id = l.credito_id
        AND ${corte}
        ${soloConCuotas}
      ${masReciente}
      LIMIT 1
    ) k
  ),${snapFinal}`;
	}

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
    ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
  ),
  snap_cuotas AS (
    SELECT DISTINCT ON (h.credito_id)
      h.credito_id,
      h.cuotas_atrasadas_nuevas AS cuotas
    FROM cartera.moras_historial h
    WHERE ${corte}
      ${soloConCuotas}
    ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
  ),${snapFinal}`;
};
