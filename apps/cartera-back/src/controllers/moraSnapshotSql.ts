import { sql } from "drizzle-orm";

// CTE: estado de mora por crédito "as-of" `fecha`.
// monto/tipo = último evento; cuotas = último evento CON cuotas>0 (carry-forward).
export const snapCte = (fecha: string, incluirFecha = true) => {
	const comparador = incluirFecha ? sql`<=` : sql`<`;
	return sql`
  snap_raw AS (
    SELECT
      h.credito_id,
      h.tipo_evento,
      h.monto_nuevo::numeric AS monto,
      h.fecha,
      ROW_NUMBER() OVER (PARTITION BY h.credito_id ORDER BY h.fecha DESC, h.historial_id DESC) AS rn,
      -- cuotas "vivas": cuotas del evento más reciente con cuotas>0. Los eventos payment-only
      -- (updateMora sin cuotas, p.ej. reversa de pago en reversePayment.ts) registran
      -- cuotas_atrasadas_nuevas=0; sin carry-forward un crédito con mora>0 cuyo último evento
      -- sea payment-only caería a "Al día" y se saldría de los buckets 30/60/90/120 (review Codex).
      FIRST_VALUE(h.cuotas_atrasadas_nuevas) OVER (
        PARTITION BY h.credito_id
        ORDER BY (h.cuotas_atrasadas_nuevas > 0) DESC, h.fecha DESC, h.historial_id DESC
      ) AS cuotas
    FROM cartera.moras_historial h
    -- Corte por DÍA Guatemala: fecha es timestamp UTC (defaultNow, session UTC) y el cron
    -- corre ~23:59 GT (≈06:00 UTC del día siguiente); comparar en GT evita correr esos
    -- eventos al día siguiente.
    WHERE (h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date ${comparador} ${fecha}::date
  ),
  snap AS (
    SELECT credito_id, tipo_evento, monto, cuotas, fecha FROM snap_raw WHERE rn = 1
  )`;
};
