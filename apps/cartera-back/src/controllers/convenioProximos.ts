import { db } from "../database";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Recordatorios de CONVENIO — cuotas del convenio próximas a vencer.
// Solo lectura: el CRM lo consume con su job diario D-5/D-3/D-1/D-0 (el WhatsApp
// vive allá). Hermano de getCuotasProximasVencer (premora), pero para créditos
// EN_CONVENIO, que el funnel premora NO toca.
//
// Modelo (ver bucketsConvenio.ts): en convenio el cliente paga AMBAS cada mes —
// la cuota NORMAL del crédito Y la del CONVENIO, que vencen el mismo día (el
// convenio le presta las fechas). Se maneja del convenio (`convenio_cuotas`,
// fecha_pago IS NULL = impaga) porque ahí vive el pago del convenio, y el monto
// a recordar = cuota normal + cuota del convenio (el "Total a Pagar" de la
// pantalla). `cuota_id` = cuota_convenio_id (para la idempotencia del CRM).
// ─────────────────────────────────────────────────────────────────────────────

export async function getConvenioProximosVencer(dias: number[]) {
  const hoyGT = sql`(now() AT TIME ZONE 'America/Guatemala')::date`;
  const diasList = sql.join(
    dias.map((d) => sql`${d}`),
    sql`, `,
  );

  const res = await db.execute<any>(sql`
    SELECT
      cc.cuota_convenio_id AS cuota_id,
      c.credito_id,
      cc.numero_cuota,
      cc.fecha_vencimiento::date::text AS fecha_vencimiento,
      (cc.fecha_vencimiento::date - ${hoyGT})::int AS dias_para_vencer,
      c.numero_credito_sifco,
      c."statusCredit" AS status_credit,
      -- Bucket MOTOR (último de buckets_historial): lo siembra el job de buckets
      -- de convenio. NULL si aún no tiene INICIAL.
      (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
        WHERE h.credito_id = c.credito_id
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1) AS bucket,
      -- monto_cuota = TOTAL a pagar del mes = cuota normal del crédito + cuota
      -- del convenio ("ambas cosas"). Es lo que el cliente debe ese día.
      -- monto_convenio = lo que RESTA de ESTA cuota del convenio, medido por MONTO
      -- (no por fecha_pago): monto_pagado se aplica en orden, así que lo que resta
      -- de la cuota K = K*cuota_mensual - monto_pagado, acotado a [0, cuota_mensual].
      -- Cubre el abono PARCIAL (aunque no complete la cuota ni marque fecha_pago) y
      -- los parciales ACUMULATIVOS (Q60+Q40) sin sobre-cobrar en el WhatsApp.
      -- monto_normal = la cuota normal del crédito de ESE mes SOLO si sigue impaga
      -- (norm.monto, calculado en el LATERAL de abajo cruzando cuotas_credito por
      -- fecha con el mismo criterio que premora). Si ya la pagó, es 0 → el
      -- recordatorio pide solo el convenio, sin sobre-cobrar una cuota ya pagada.
      ROUND((COALESCE(norm.monto, 0) + LEAST(cp.cuota_mensual, GREATEST(0,
        cc.numero_cuota * cp.cuota_mensual - cp.monto_pagado)))::numeric, 2)::text AS monto_cuota,
      ROUND(COALESCE(norm.monto, 0)::numeric, 2)::text AS monto_normal,
      ROUND(LEAST(cp.cuota_mensual, GREATEST(0,
        cc.numero_cuota * cp.cuota_mensual - cp.monto_pagado))::numeric, 2)::text AS monto_convenio,
      -- Compatibilidad de forma con CarteraCuotaProximaVencer (no aplican acá).
      '0.00'::text AS monto_mora,
      0::int AS cuotas_atrasadas,
      0::int AS cuotas_vencidas_reales,
      u.nombre AS cliente,
      NULL::text AS telefono_cliente_cartera,
      c.asesor_id,
      a.nombre AS asesor,
      a.telefono AS telefono_asesor
    FROM ${SQL_CARTERA_SCHEMA}.convenio_cuotas cc
    INNER JOIN ${SQL_CARTERA_SCHEMA}.convenios_pago cp
      ON cp.convenio_id = cc.convenio_id AND cp.completado = false AND cp.activo = true
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c
      ON c.credito_id = cp.credito_id AND c."statusCredit" = 'EN_CONVENIO'
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    -- Cuota normal del crédito que vence el MISMO día que esta cuota del convenio
    -- (el convenio le presta las fechas). Vale c.cuota solo si sigue impaga con el
    -- criterio de premora (sin pago cubriente ni boleta pendiente); si ya la pagó, 0.
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN cu2.pagado = false
          AND NOT EXISTS (
            SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
             WHERE pc.cuota_id = cu2.cuota_id AND pc."paymentFalse" = false
               AND pc.pagado = true AND pc.validation_status IN ('validated', 'no_required')
               AND COALESCE(pc.monto_aplicado, 0) > 0)
          AND NOT EXISTS (
            SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pr
             WHERE pr.cuota_id = cu2.cuota_id AND pr."paymentFalse" = false
               AND pr.validation_status = 'pending' AND COALESCE(pr.monto_boleta, 0) > 0)
        THEN c.cuota ELSE 0 END AS monto
      FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu2
      WHERE cu2.credito_id = c.credito_id
        AND cu2.fecha_vencimiento::date = cc.fecha_vencimiento::date
      ORDER BY cu2.cuota_id
      LIMIT 1
    ) norm ON true
    WHERE cc.fecha_pago IS NULL
      -- No recordar cuotas ya CUBIERTAS por parciales acumulativos: si
      -- monto_pagado ya alcanza K*cuota_mensual, la cuota K está saldada aunque
      -- fecha_pago siga NULL (processConvenioPayment solo marca fecha_pago con un
      -- pago >= cuota_mensual). Sin esto se mandaría un WhatsApp con convenio=0.
      AND cp.monto_pagado < cc.numero_cuota * cp.cuota_mensual
      AND (cc.fecha_vencimiento::date - ${hoyGT}) IN (${diasList})
    ORDER BY dias_para_vencer ASC, u.nombre ASC, cc.cuota_convenio_id ASC
  `);

  const rows = res.rows as Array<Record<string, unknown>>;
  return { success: true, total: rows.length, data: rows };
}
