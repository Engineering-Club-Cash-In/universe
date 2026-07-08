import { sql } from "drizzle-orm";
import { db } from "../database";
import { snapCte } from "./moraHistorial";

type Periodo = "anio" | "trimestre" | "mes" | "semana" | "dia";

const toPostgresPeriod: Record<Periodo, string> = {
  anio: "'year'",
  trimestre: "'quarter'",
  mes: "'month'",
  semana: "'week'",
  dia: "'day'",
};

export async function getMontoACobrar({
  periodo,
  fechaInicio,
  fechaFin,
}: {
  periodo: Periodo;
  fechaInicio: string;
  fechaFin: string;
}) {
  const pg = sql.raw(toPostgresPeriod[periodo]);

  const result = await db.execute(sql`
    WITH bucket_creditos AS (
      SELECT DISTINCT
        DATE_TRUNC(${pg}, c.fecha_vencimiento::timestamp) AS bucket,
        cr.credito_id
      FROM cartera.cuotas_credito c
      JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
      WHERE c.pagado = false
        AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
        AND c.fecha_vencimiento >= ${fechaInicio}::date
        AND c.fecha_vencimiento <= ${fechaFin}::date
    ),
    mora_por_bucket AS (
      SELECT
        bc.bucket,
        AVG(COALESCE(m.monto_mora::numeric, 0)) AS mora_promedio
      FROM bucket_creditos bc
      LEFT JOIN cartera.moras_credito m ON m.credito_id = bc.credito_id AND m.activa = true
      GROUP BY bc.bucket
    )
    SELECT
      DATE_TRUNC(${pg}, c.fecha_vencimiento::timestamp) AS bucket,
      COUNT(c.cuota_id)::int AS cuotas_count,
      COALESCE(SUM(cr.cuota::numeric - cr.cuota_interes::numeric - cr.iva_12::numeric - cr.seguro_10_cuotas::numeric - cr.gps::numeric - cr.membresias_pago::numeric), 0) AS total_cuota,
      COALESCE(SUM(cr.cuota_interes::numeric), 0) AS total_interes,
      COALESCE(SUM(cr.iva_12::numeric), 0) AS total_iva,
      COALESCE(SUM(cr.seguro_10_cuotas::numeric), 0) AS total_seguro,
      COALESCE(SUM(cr.gps::numeric), 0) AS total_gps,
      COALESCE(SUM(cr.membresias_pago::numeric), 0) AS total_membresias,
      COALESCE(SUM(cr.royalti::numeric / NULLIF(cr.plazo::numeric, 0)), 0) AS total_royalti,
      COALESCE(mpb.mora_promedio, 0) AS mora_promedio
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    JOIN mora_por_bucket mpb ON mpb.bucket = DATE_TRUNC(${pg}, c.fecha_vencimiento::timestamp)
    WHERE c.pagado = false
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
      AND c.fecha_vencimiento >= ${fechaInicio}::date
      AND c.fecha_vencimiento <= ${fechaFin}::date
    GROUP BY DATE_TRUNC(${pg}, c.fecha_vencimiento::timestamp), mpb.mora_promedio
    ORDER BY bucket ASC
  `);

  return result.rows;
}

export async function getMontoACobrarPeriodo({
  periodo,
  fechaInicio,
  fechaFin,
}: {
  periodo: Periodo;
  fechaInicio: string;
  fechaFin: string;
}) {
  const pg = sql.raw(toPostgresPeriod[periodo]);
  const pgIntervalMap: Record<Periodo, string> = {
    anio: "1 year",
    trimestre: "3 months",
    mes: "1 month",
    semana: "1 week",
    dia: "1 day",
  };
  const pgInterval = sql.raw(`interval '${pgIntervalMap[periodo]}'`);

  const result = await db.execute(sql`
    WITH
    pagos_en_rango AS (
      SELECT
        pc.credito_id,
        pc.cuota_id,
        q.fecha_vencimiento                                                                                                AS fecha_venc,
        COALESCE(MIN(pc.capital_restante::numeric) FILTER (WHERE NOT pc."paymentFalse"), 0) + COALESCE(SUM(pc.abono_capital::numeric) FILTER (WHERE NOT pc."paymentFalse"), 0)   AS capital_restante,
        COALESCE(MIN(pc.interes_restante::numeric) FILTER (WHERE NOT pc."paymentFalse"), 0) + COALESCE(SUM(pc.abono_interes::numeric) FILTER (WHERE NOT pc."paymentFalse"), 0)   AS interes_restante,
        COALESCE(MIN(pc.iva_12_restante::numeric)  FILTER (WHERE NOT pc."paymentFalse"), 0) + COALESCE(SUM(pc.abono_iva_12::numeric)   FILTER (WHERE NOT pc."paymentFalse"), 0)  AS iva_12_restante,
        COALESCE(MIN(pc.seguro_restante::numeric)  FILTER (WHERE NOT pc."paymentFalse"), 0) + COALESCE(SUM(pc.abono_seguro::numeric)   FILTER (WHERE NOT pc."paymentFalse"), 0)  AS seguro_restante,
        COALESCE(MIN(pc.gps_restante::numeric)     FILTER (WHERE NOT pc."paymentFalse"), 0) + COALESCE(SUM(pc.abono_gps::numeric)      FILTER (WHERE NOT pc."paymentFalse"), 0)  AS gps_restante,
        COALESCE(MIN(pc.membresias::numeric)       FILTER (WHERE NOT pc."paymentFalse"), 0) + COALESCE(SUM(pc.membresias_pago::numeric) FILTER (WHERE NOT pc."paymentFalse"), 0) AS membresias,
        SUM(COALESCE(pc.monto_boleta::numeric, 0))                                                                         AS monto_boleta
      FROM cartera.pagos_credito pc
      JOIN cartera.cuotas_credito q ON q.cuota_id = pc.cuota_id
      WHERE q.fecha_vencimiento::date >= ${fechaInicio}::date
        AND q.fecha_vencimiento::date <= ${fechaFin}::date
      GROUP BY pc.credito_id, pc.cuota_id, q.fecha_vencimiento

      UNION ALL

      SELECT
        pc.credito_id,
        pc.cuota_id,
        pc.fecha_vencimiento                                                                             AS fecha_venc,
        COALESCE(pc.capital_restante::numeric, 0)  + COALESCE(pc.abono_capital::numeric, 0)             AS capital_restante,
        COALESCE(pc.interes_restante::numeric, 0)  + COALESCE(pc.abono_interes::numeric, 0)             AS interes_restante,
        COALESCE(pc.iva_12_restante::numeric, 0)   + COALESCE(pc.abono_iva_12::numeric, 0)              AS iva_12_restante,
        COALESCE(pc.seguro_restante::numeric, 0)   + COALESCE(pc.abono_seguro::numeric, 0)              AS seguro_restante,
        COALESCE(pc.gps_restante::numeric, 0)      + COALESCE(pc.abono_gps::numeric, 0)                 AS gps_restante,
        COALESCE(pc.membresias::numeric, 0)        + COALESCE(pc.membresias_pago::numeric, 0)           AS membresias,
        COALESCE(pc.monto_boleta::numeric, 0)                                                            AS monto_boleta
      FROM cartera.pagos_credito pc
      WHERE pc."paymentFalse" = false
        AND pc.cuota_id IS NULL
        AND pc.fecha_vencimiento::date >= ${fechaInicio}::date
        AND pc.fecha_vencimiento::date <= ${fechaFin}::date
    ),
    per_credito AS (
      SELECT
        p.fecha_venc::date                                             AS bucket,
        c.credito_id,
        c."statusCredit"                                               AS status,
        c.porcentaje_interes::numeric / 100                            AS tasa,
        c.cuota::numeric                                               AS cuota_c,
        COALESCE(c.seguro_10_cuotas::numeric, 0)                       AS seguro,
        COALESCE(c.gps::numeric, 0)                                    AS gps,
        COALESCE(c.membresias_pago::numeric, 0)                        AS mem,
        COALESCE(cap_anterior.total_restante, c.capital::numeric)       AS cap_ant,
        MAX(mora_real.cuotas_atrasadas)                                 AS cuotas_atrasadas,
        CASE WHEN MAX(mora_real.cuotas_atrasadas) > 0
             THEN COALESCE(MAX(hist_mora.monto_mora), 0)
             ELSE 0 END                                                 AS mora_val
      FROM pagos_en_rango p
      INNER JOIN cartera.creditos c ON p.credito_id = c.credito_id
      INNER JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
      INNER JOIN cartera.asesores a ON c.asesor_id = a.asesor_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(mh.monto_nuevo, 0) AS monto_mora
        FROM cartera.moras_historial mh
        WHERE mh.credito_id = c.credito_id
          AND (mh.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala') < DATE_TRUNC(${pg}, p.fecha_venc::timestamp) + ${pgInterval}
        ORDER BY mh.fecha DESC
        LIMIT 1
      ) hist_mora ON true
      LEFT JOIN LATERAL (
        SELECT pc_a.total_restante::numeric AS total_restante
        FROM cartera.pagos_credito pc_a
        LEFT JOIN cartera.cuotas_credito qcc_a ON pc_a.cuota_id = qcc_a.cuota_id
        WHERE pc_a.credito_id = c.credito_id
          AND pc_a."paymentFalse" = false
          AND pc_a.total_restante IS NOT NULL
          AND pc_a.total_restante::numeric > 0
          AND COALESCE(
            qcc_a.fecha_vencimiento::date,
            GREATEST(
              COALESCE(pc_a.fecha_boleta::date, pc_a.fecha_pago::date, '1900-01-01'::date),
              COALESCE(pc_a.fecha_pago::date,   pc_a.fecha_boleta::date, '1900-01-01'::date)
            )
          ) < DATE_TRUNC(${pg}, p.fecha_venc::timestamp)::date
        ORDER BY COALESCE(
          qcc_a.fecha_vencimiento::date,
          GREATEST(
            COALESCE(pc_a.fecha_boleta::date, pc_a.fecha_pago::date, '1900-01-01'::date),
            COALESCE(pc_a.fecha_pago::date,   pc_a.fecha_boleta::date, '1900-01-01'::date)
          )
        ) DESC, pc_a.pago_id DESC
        LIMIT 1
      ) cap_anterior ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cuotas_atrasadas
        FROM cartera.cuotas_credito qc_mora
        WHERE qc_mora.credito_id = c.credito_id
          AND qc_mora.fecha_vencimiento::date < p.fecha_venc::date
          AND NOT EXISTS (
            SELECT 1 FROM cartera.pagos_credito pc_mora
            WHERE pc_mora.cuota_id = qc_mora.cuota_id
              AND pc_mora."paymentFalse" = false
              AND pc_mora.pagado = true
              AND pc_mora.validation_status IN ('validated', 'no_required')
              AND COALESCE(pc_mora.fecha_boleta::date, pc_mora.fecha_pago::date) <= p.fecha_venc::date
          )
      ) mora_real ON true
      GROUP BY
        p.fecha_venc::date,
        c.credito_id, c."statusCredit", c.capital, c.porcentaje_interes, c.cuota,
        c.seguro_10_cuotas, c.gps, c.membresias_pago,
        cap_anterior.total_restante, mora_real.cuotas_atrasadas
      HAVING (
        SUM(COALESCE(p.capital_restante, 0)) +
        SUM(COALESCE(p.interes_restante, 0)) +
        SUM(COALESCE(p.iva_12_restante, 0))  +
        SUM(COALESCE(p.seguro_restante, 0))  +
        SUM(COALESCE(p.gps_restante, 0))     +
        SUM(COALESCE(p.membresias, 0))       +
        SUM(COALESCE(p.monto_boleta, 0))
      ) <> 0
    ),
    calc AS (
      SELECT *,
        ROUND(cap_ant * tasa, 2)                   AS interes,
        ROUND(ROUND(cap_ant * tasa, 2) * 0.12, 2)  AS iva
      FROM per_credito
    ),
    calc_acum AS (
      SELECT
        calc.*,
        (calc.status IN ('EN_CONVENIO', 'INCOBRABLE', 'CANCELADO', 'PENDIENTE_CANCELACION', 'CAIDO')) AS excluido_mora,
        (calc.status IN ('CANCELADO', 'INCOBRABLE', 'PENDIENTE_CANCELACION'))                          AS excluido_factura,
        LEAST(GREATEST(cuota_c - interes - iva - seguro - gps - mem, 0::numeric), cap_ant)             AS exp_capital,
        COALESCE(acum.acum_capital, 0) AS acum_capital,
        COALESCE(acum.acum_interes, 0) AS acum_interes,
        COALESCE(acum.acum_iva,     0) AS acum_iva,
        COALESCE(acum.acum_seguro,  0) AS acum_seguro,
        COALESCE(acum.acum_gps,     0) AS acum_gps,
        COALESCE(acum.acum_mem,     0) AS acum_mem
      FROM calc
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(LEAST(
            a.capital_restante,
            GREATEST(calc.cuota_c - a.interes_restante - a.iva_12_restante
                     - a.seguro_restante - a.gps_restante - a.membresias, 0::numeric)
          )), 0) AS acum_capital,
          COALESCE(SUM(a.interes_restante), 0) AS acum_interes,
          COALESCE(SUM(a.iva_12_restante),  0) AS acum_iva,
          COALESCE(SUM(a.seguro_restante),  0) AS acum_seguro,
          COALESCE(SUM(a.gps_restante),     0) AS acum_gps,
          COALESCE(SUM(a.membresias),       0) AS acum_mem
        FROM (
          SELECT
            COALESCE(MIN(pc_a.capital_restante::numeric), 0) AS capital_restante,
            COALESCE(MIN(pc_a.interes_restante::numeric), 0) AS interes_restante,
            COALESCE(MIN(pc_a.iva_12_restante::numeric),  0) AS iva_12_restante,
            COALESCE(MIN(pc_a.seguro_restante::numeric),  0) AS seguro_restante,
            COALESCE(MIN(pc_a.gps_restante::numeric),     0) AS gps_restante,
            COALESCE(MIN(pc_a.membresias::numeric),       0) AS membresias
          FROM cartera.cuotas_credito q_a
          LEFT JOIN cartera.pagos_credito pc_a
            ON pc_a.cuota_id = q_a.cuota_id
            AND pc_a."paymentFalse" = false
          WHERE q_a.credito_id = calc.credito_id
            AND q_a.fecha_vencimiento::date < calc.bucket
            AND NOT EXISTS (
              SELECT 1 FROM cartera.pagos_credito pc2
              WHERE pc2.cuota_id = q_a.cuota_id
                AND pc2."paymentFalse" = false
                AND pc2.pagado = true
                AND pc2.validation_status IN ('validated', 'no_required')
                AND COALESCE(pc2.fecha_boleta::date, pc2.fecha_pago::date) <= calc.bucket
            )
          GROUP BY q_a.cuota_id
          HAVING (
              COALESCE(MIN(pc_a.capital_restante::numeric), 0)
            + COALESCE(MIN(pc_a.interes_restante::numeric), 0)
            + COALESCE(MIN(pc_a.iva_12_restante::numeric),  0)
            + COALESCE(MIN(pc_a.seguro_restante::numeric),  0)
            + COALESCE(MIN(pc_a.gps_restante::numeric),     0)
            + COALESCE(MIN(pc_a.membresias::numeric),       0)
          ) > 0
          OR COUNT(pc_a.pago_id) = 0
          OR MIN(pc_a.capital_restante) IS NULL
        ) a
      ) acum ON calc.cuotas_atrasadas > 0
    ),
    per_bucket_credit AS (
      SELECT
        DATE_TRUNC(${pg}, bucket::timestamp)    AS bucket,
        credito_id,
        MAX(excluido_mora::int)::bool           AS excluido_mora,
        MAX(excluido_factura::int)::bool        AS excluido_factura,
        SUM(exp_capital)                        AS exp_capital,
        SUM(interes)                            AS interes,
        SUM(iva)                                AS iva,
        SUM(seguro)                             AS seguro,
        SUM(gps)                                AS gps,
        SUM(mem)                                AS mem,
        MAX(mora_val)                           AS mora_val,
        MAX(cuotas_atrasadas)                   AS cuotas_atrasadas,
        MIN(cap_ant)                            AS cap_ant,
        MAX(acum_capital)                       AS acum_capital,
        MAX(acum_interes)                       AS acum_interes,
        MAX(acum_iva)                           AS acum_iva,
        MAX(acum_seguro)                        AS acum_seguro,
        MAX(acum_gps)                           AS acum_gps,
        MAX(acum_mem)                           AS acum_mem,
        COUNT(*)::int                           AS cuotas_count
      FROM calc_acum
      GROUP BY DATE_TRUNC(${pg}, bucket::timestamp), credito_id
    ),
    -- Interés a inversionistas: lo efectivamente distribuido a inversionistas EXTERNOS
    -- (inversionistas.permite_distribucion = false → se ignoran los nuestros), tomado de
    -- pagos_credito_inversionistas como interés + IVA (abono_interes + abono_iva_12),
    -- agrupado por fecha_pago en zona Guatemala. Informativo: NO se suma al Total.
    inv_pagos_por_bucket AS (
      SELECT
        DATE_TRUNC(${pg}, (pci.fecha_pago AT TIME ZONE 'America/Guatemala')::timestamp) AS pagos_bucket,
        COALESCE(SUM(pci.abono_interes::numeric + pci.abono_iva_12::numeric), 0)        AS total_interes_inversionista
      FROM cartera.pagos_credito_inversionistas pci
      WHERE pci.inversionista_id IN (
        SELECT inversionista_id FROM cartera.inversionistas WHERE permite_distribucion = false
      )
        AND (pci.fecha_pago AT TIME ZONE 'America/Guatemala')::date >= ${fechaInicio}::date
        AND (pci.fecha_pago AT TIME ZONE 'America/Guatemala')::date <= ${fechaFin}::date
      GROUP BY DATE_TRUNC(${pg}, (pci.fecha_pago AT TIME ZONE 'America/Guatemala')::timestamp)
    )
    SELECT
      COALESCE(per_bucket_credit.bucket, ip.pagos_bucket) AS bucket,
      COALESCE(SUM(cuotas_count), 0)::int                                                        AS cuotas_count,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN exp_capital ELSE 0 END), 0)               AS total_cuota,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN interes     ELSE 0 END), 0)               AS total_interes,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN iva         ELSE 0 END), 0)               AS total_iva,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN seguro      ELSE 0 END), 0)               AS total_seguro,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN gps         ELSE 0 END), 0)               AS total_gps,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN mem         ELSE 0 END), 0)               AS total_membresias,
      COALESCE(SUM(mora_val) FILTER (WHERE cuotas_atrasadas > 0 AND NOT excluido_mora), 0)       AS total_mora,
      COALESCE(SUM(cuotas_atrasadas) FILTER (WHERE cuotas_atrasadas > 0 AND NOT excluido_mora), 0)::int AS mora_count,
      COUNT(credito_id)::int                                                                    AS total_credits,
      COUNT(credito_id) FILTER (WHERE cuotas_atrasadas > 0 AND NOT excluido_mora)::int          AS credits_con_mora,
      COALESCE(SUM(CASE
        WHEN excluido_mora     THEN 0
        WHEN cuotas_atrasadas > 0 THEN LEAST(acum_capital, cap_ant)
        ELSE exp_capital END), 0)                                                                 AS acum_total_cuota,
      COALESCE(SUM(CASE
        WHEN excluido_mora     THEN 0
        WHEN cuotas_atrasadas > 0 THEN acum_interes
        ELSE interes END), 0)                                                                     AS acum_total_interes,
      COALESCE(SUM(CASE
        WHEN excluido_mora     THEN 0
        WHEN cuotas_atrasadas > 0 THEN acum_iva
        ELSE iva END), 0)                                                                         AS acum_total_iva,
      COALESCE(SUM(CASE
        WHEN excluido_mora     THEN 0
        WHEN cuotas_atrasadas > 0 THEN acum_seguro
        ELSE seguro END), 0)                                                                      AS acum_total_seguro,
      COALESCE(SUM(CASE
        WHEN excluido_mora     THEN 0
        WHEN cuotas_atrasadas > 0 THEN acum_gps
        ELSE gps END), 0)                                                                         AS acum_total_gps,
      COALESCE(SUM(CASE
        WHEN excluido_mora     THEN 0
        WHEN cuotas_atrasadas > 0 THEN acum_mem
        ELSE mem END), 0)                                                                         AS acum_total_membresias,
      -- Interés a inversionistas (lo distribuido a externos). Por período: lo pagado en ese
      -- bucket. Acumulado: suma corrida hasta el bucket (el último bucket = gran total).
      COALESCE(MAX(ip.total_interes_inversionista), 0)                                            AS total_interes_inversionista,
      COALESCE(SUM(COALESCE(MAX(ip.total_interes_inversionista), 0)) OVER (ORDER BY COALESCE(per_bucket_credit.bucket, ip.pagos_bucket)), 0)   AS acum_total_interes_inversionista
    -- FULL JOIN: el resultado se arma desde la unión de buckets de ambas fuentes, para que un
    -- período con pagos a inversionistas pero SIN cuotas pendientes (posible en vista
    -- día/semana) no se pierda ni subestime la columna.
    FROM per_bucket_credit
    FULL JOIN inv_pagos_por_bucket ip ON ip.pagos_bucket = per_bucket_credit.bucket
    GROUP BY COALESCE(per_bucket_credit.bucket, ip.pagos_bucket)
    ORDER BY COALESCE(per_bucket_credit.bucket, ip.pagos_bucket) ASC
  `);

  return result.rows;
}

export async function getCobradoDelMes({
  mes,
  anio,
}: {
  mes: number;
  anio: number;
}) {
  // Guatemala is UTC-6 (no DST). Midnight GT = 06:00 UTC.
  const inicioMesUtc = new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0));
  const inicioMesSiguienteUtc = new Date(Date.UTC(anio, mes, 1, 6, 0, 0));
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(p.abono_capital::numeric), 0) AS cobrado_capital,
      COALESCE(SUM(p.abono_interes::numeric + COALESCE(p.abono_interes_ci::numeric, 0)), 0) AS cobrado_interes,
      COALESCE(SUM(p.abono_iva_12::numeric + COALESCE(p.abono_iva_ci::numeric, 0)), 0) AS cobrado_iva,
      COALESCE(SUM(p.abono_seguro::numeric), 0) AS cobrado_seguro,
      COALESCE(SUM(p.abono_gps::numeric), 0) AS cobrado_gps,
      COALESCE(SUM(p.membresias_pago::numeric), 0) AS cobrado_membresias
    FROM cartera.pagos_credito p
    JOIN cartera.creditos cr ON p.credito_id = cr.credito_id
    WHERE p.fecha_pago >= ${inicioMesUtc.toISOString()}::timestamptz
      AND p.fecha_pago < ${inicioMesSiguienteUtc.toISOString()}::timestamptz
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO', 'CANCELADO')
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    cobrado_capital: String(row?.cobrado_capital ?? "0"),
    cobrado_interes: String(row?.cobrado_interes ?? "0"),
    cobrado_iva: String(row?.cobrado_iva ?? "0"),
    cobrado_seguro: String(row?.cobrado_seguro ?? "0"),
    cobrado_gps: String(row?.cobrado_gps ?? "0"),
    cobrado_membresias: String(row?.cobrado_membresias ?? "0"),
  };
}

export async function getCobradoDelMesSnapshot({
  mes,
  anio,
}: {
  mes: number;
  anio: number;
}) {
  // Filtramos por rango de fecha (no por anio/mes) porque esas columnas helper
  // pueden venir NULL en filas importadas → quedarían fuera del SUM.
  const inicioMes = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(interes_cube::numeric), 0)           AS cobrado_interes,
      COALESCE(SUM(membresia::numeric), 0)              AS cobrado_membresias,
      COALESCE(SUM(servicios_seguro_gps::numeric), 0)   AS cobrado_seguro_gps,
      COALESCE(SUM(royalty::numeric), 0)                AS cobrado_royalti,
      COALESCE(SUM(mora_cube::numeric), 0)              AS cobrado_mora,
      COALESCE(SUM(otros_ingresos::numeric), 0)         AS cobrado_otros
    FROM cartera.facturacion_snapshot_diario
    WHERE fecha >= ${inicioMes}::date
      AND fecha < (${inicioMes}::date + INTERVAL '1 month')
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    cobrado_interes: String(row?.cobrado_interes ?? "0"),
    cobrado_membresias: String(row?.cobrado_membresias ?? "0"),
    cobrado_seguro_gps: String(row?.cobrado_seguro_gps ?? "0"),
    cobrado_royalti: String(row?.cobrado_royalti ?? "0"),
    cobrado_mora: String(row?.cobrado_mora ?? "0"),
    cobrado_otros: String(row?.cobrado_otros ?? "0"),
  };
}

export async function getEsperadoDelMesMeta({
  mes,
  anio,
}: {
  mes: number;
  anio: number;
}) {
  const result = await db.execute(sql`
    SELECT meta_mensual
    FROM cartera.metas_facturacion
    WHERE anio = ${anio} AND mes = ${mes}
    LIMIT 1
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    meta_mensual: String(row?.meta_mensual ?? "0"),
  };
}

export async function getFlujoCuotasInversiones({
  fechaInicio,
  fechaFin,
}: {
  fechaInicio: string;
  fechaFin: string;
}) {
  const rows = await db.execute(sql`
    SELECT
      CASE
        WHEN i.tipo_reinversion = 'reinversion_combinada'
        THEN COALESCE(ce.tipo_reinversion::text, 'sin_reinversion')
        ELSE i.tipo_reinversion::text
      END AS tipo_reinv_efectivo,
      i.inversionista_id,
      i.nombre,
      COALESCE(SUM(ci.cuota_inversionista::numeric), 0) AS total_capital,
      COALESCE(SUM(ci.monto_inversionista::numeric), 0) AS total_interes,
      COALESCE(SUM(ci.iva_inversionista::numeric), 0)   AS total_iva,
      MAX(i.monto_reinversion::numeric)                  AS monto_reinversion_inv
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    JOIN cartera.creditos_inversionistas ci ON cr.credito_id = ci.credito_id
    JOIN cartera.inversionistas i ON ci.inversionista_id = i.inversionista_id
    LEFT JOIN cartera.creditos_inversionistas_espejo ce
      ON cr.credito_id = ce.credito_id AND ci.inversionista_id = ce.inversionista_id
    WHERE c.pagado = false
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
      AND c.fecha_vencimiento >= ${fechaInicio}::date
      AND c.fecha_vencimiento <= ${fechaFin}::date
    GROUP BY tipo_reinv_efectivo, i.inversionista_id, i.nombre
    ORDER BY tipo_reinv_efectivo, i.nombre
  `);

  const extrasRows = await db.execute(sql`
    SELECT tipo, COALESCE(SUM(monto::numeric), 0) AS total
    FROM cartera.abonos_capital
    WHERE created_at::date >= ${fechaInicio}::date
      AND created_at::date <= ${fechaFin}::date
    GROUP BY tipo
  `);

  const reinvPorTipo: Record<string, { capital: number; interes: number; iva: number; monto_reinvertido: number }> = {};
  const cashParcialPorTipo: Record<string, { capital: number; interes: number; iva: number; monto_cash: number }> = {};
  const sinReinvTotals = { capital: 0, interes: 0, iva: 0 };
  const porInversionista: Record<number, { inversionista_id: number; nombre: string; capital: number; interes: number; iva: number }> = {};

  for (const row of rows.rows as Record<string, unknown>[]) {
    const capital = Number(row.total_capital);
    const interes = Number(row.total_interes);
    const iva = Number(row.total_iva);
    const tipo = String(row.tipo_reinv_efectivo);
    if (tipo !== "sin_reinversion") {
      if (!reinvPorTipo[tipo]) reinvPorTipo[tipo] = { capital: 0, interes: 0, iva: 0, monto_reinvertido: 0 };
      if (!cashParcialPorTipo[tipo]) cashParcialPorTipo[tipo] = { capital: 0, interes: 0, iva: 0, monto_cash: 0 };
      const totalCuota = capital + interes + iva;
      const montoReinvInv = Number(row.monto_reinversion_inv ?? 0);
      if (tipo === "reinversion_variable") {
        const reinvertido = Math.min(montoReinvInv, totalCuota);
        reinvPorTipo[tipo].monto_reinvertido += reinvertido;
        cashParcialPorTipo[tipo].monto_cash += Math.max(0, totalCuota - reinvertido);
      } else if (tipo === "reinversion_excedente") {
        // monto_reinversion = monto fijo que RECIBE en cash; el sobrante se reinvierte
        const recibe = Math.min(montoReinvInv, totalCuota);
        cashParcialPorTipo[tipo].monto_cash += recibe;
        reinvPorTipo[tipo].monto_reinvertido += Math.max(0, totalCuota - recibe);
      } else if (tipo === "reinversion_capital") {
        reinvPorTipo[tipo].capital += capital;
        cashParcialPorTipo[tipo].interes += interes;
        cashParcialPorTipo[tipo].iva += iva;
      } else if (tipo === "reinversion_interes") {
        reinvPorTipo[tipo].interes += interes;
        reinvPorTipo[tipo].iva += iva;
        cashParcialPorTipo[tipo].capital += capital;
      } else {
        // reinversion_total: nada va a cash
        reinvPorTipo[tipo].capital += capital;
        reinvPorTipo[tipo].interes += interes;
        reinvPorTipo[tipo].iva += iva;
      }
    } else {
      sinReinvTotals.capital += capital;
      sinReinvTotals.interes += interes;
      sinReinvTotals.iva += iva;
      const id = Number(row.inversionista_id);
      if (!porInversionista[id]) {
        porInversionista[id] = { inversionista_id: id, nombre: String(row.nombre), capital: 0, interes: 0, iva: 0 };
      }
      porInversionista[id].capital += capital;
      porInversionista[id].interes += interes;
      porInversionista[id].iva += iva;
    }
  }

  let abonosCapital = 0;
  let cancelaciones = 0;
  for (const row of extrasRows.rows as Record<string, unknown>[]) {
    if (row.tipo === "CAPITAL") abonosCapital = Number(row.total);
    if (row.tipo === "CANCELACION") cancelaciones = Number(row.total);
  }

  const fmt = (n: number) => n.toFixed(2);

  return {
    reinversionPorTipo: Object.entries(reinvPorTipo).map(([tipo, v]) => ({
      tipo,
      capital: fmt(v.capital),
      interes: fmt(v.interes),
      iva: fmt(v.iva),
      monto_reinvertido: v.monto_reinvertido > 0 ? fmt(v.monto_reinvertido) : undefined,
    })),
    cashParcialPorTipo: Object.entries(cashParcialPorTipo)
      .filter(([, v]) => v.capital + v.interes + v.iva + v.monto_cash > 0)
      .map(([tipo, v]) => ({
        tipo,
        capital: fmt(v.capital),
        interes: fmt(v.interes),
        iva: fmt(v.iva),
        monto_cash: v.monto_cash > 0 ? fmt(v.monto_cash) : undefined,
      })),
    sinReinversion: {
      totales: {
        capital: fmt(sinReinvTotals.capital),
        interes: fmt(sinReinvTotals.interes),
        iva: fmt(sinReinvTotals.iva),
      },
      porInversionista: Object.values(porInversionista).map((inv) => ({
        inversionista_id: inv.inversionista_id,
        nombre: inv.nombre,
        capital: fmt(inv.capital),
        interes: fmt(inv.interes),
        iva: fmt(inv.iva),
      })),
    },
    pagosExtras: {
      abonos_capital: fmt(abonosCapital),
      cancelaciones: fmt(cancelaciones),
    },
  };
}


export async function getFlujoCuotasPorInversionista({
  fechaInicio,
  fechaFin,
}: {
  fechaInicio: string;
  fechaFin: string;
}) {
  const rows = await db.execute(sql`
    SELECT
      CASE
        WHEN i.tipo_reinversion = 'reinversion_combinada'
        THEN COALESCE(ce.tipo_reinversion::text, 'sin_reinversion')
        ELSE i.tipo_reinversion::text
      END AS tipo_reinv_efectivo,
      i.inversionista_id,
      i.nombre,
      COALESCE(SUM(ci.cuota_inversionista::numeric), 0) AS total_capital,
      COALESCE(SUM(ci.monto_inversionista::numeric), 0) AS total_interes,
      COALESCE(SUM(ci.iva_inversionista::numeric), 0)   AS total_iva,
      MAX(i.monto_reinversion::numeric)                  AS monto_reinversion_inv
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    JOIN cartera.creditos_inversionistas ci ON cr.credito_id = ci.credito_id
    JOIN cartera.inversionistas i ON ci.inversionista_id = i.inversionista_id
    LEFT JOIN cartera.creditos_inversionistas_espejo ce
      ON cr.credito_id = ce.credito_id AND ci.inversionista_id = ce.inversionista_id
    WHERE c.pagado = false
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
      AND c.fecha_vencimiento >= ${fechaInicio}::date
      AND c.fecha_vencimiento <= ${fechaFin}::date
    GROUP BY tipo_reinv_efectivo, i.inversionista_id, i.nombre
    ORDER BY i.nombre
  `);

  const fmt = (n: number) => n.toFixed(2);

  type InvRow = {
    inversionista_id: number;
    nombre: string;
    reinv_capital: number;
    reinv_interes: number;
    cash_capital: number;
    cash_interes: number;
  };

  const porInv: Record<number, InvRow> = {};

  for (const row of rows.rows as Record<string, unknown>[]) {
    const id = Number(row.inversionista_id);
    const nombre = String(row.nombre);
    const capital = Number(row.total_capital);
    const interes = Number(row.total_interes);
    const iva = Number(row.total_iva);
    const tipo = String(row.tipo_reinv_efectivo);
    const montoReinvInv = Number(row.monto_reinversion_inv ?? 0);
    const totalCuota = capital + interes + iva;

    if (!porInv[id]) {
      porInv[id] = { inversionista_id: id, nombre, reinv_capital: 0, reinv_interes: 0, cash_capital: 0, cash_interes: 0 };
    }

    const inv = porInv[id];

    if (tipo === "sin_reinversion") {
      inv.cash_capital += capital;
      inv.cash_interes += interes + iva;
    } else if (tipo === "reinversion_capital") {
      inv.reinv_capital += capital;
      inv.cash_interes += interes + iva;
    } else if (tipo === "reinversion_interes") {
      inv.reinv_interes += interes + iva;
      inv.cash_capital += capital;
    } else if (tipo === "reinversion_total") {
      inv.reinv_capital += capital;
      inv.reinv_interes += interes + iva;
    } else if (tipo === "reinversion_variable") {
      const reinvertido = Math.min(montoReinvInv, totalCuota);
      const cash = Math.max(0, totalCuota - reinvertido);
      inv.reinv_capital += reinvertido;
      inv.cash_capital += cash;
    } else if (tipo === "reinversion_excedente") {
      const recibe = Math.min(montoReinvInv, totalCuota);
      inv.cash_capital += recibe;
      inv.reinv_capital += Math.max(0, totalCuota - recibe);
    }
  }

  const lista = Object.values(porInv).sort((a, b) => a.nombre.localeCompare(b.nombre));

  let totalReinv = 0;
  let totalCash = 0;

  for (const inv of lista) {
    totalReinv += inv.reinv_capital + inv.reinv_interes;
    totalCash += inv.cash_capital + inv.cash_interes;
  }

  return {
    porInversionista: lista.map((inv) => {
      const reinvTotal = inv.reinv_capital + inv.reinv_interes;
      const cashTotal = inv.cash_capital + inv.cash_interes;
      return {
        inversionista_id: inv.inversionista_id,
        nombre: inv.nombre,
        reinversion_capital: fmt(inv.reinv_capital),
        reinversion_interes: fmt(inv.reinv_interes),
        reinversion_total: fmt(reinvTotal),
        cash_capital: fmt(inv.cash_capital),
        cash_interes: fmt(inv.cash_interes),
        cash_total: fmt(cashTotal),
        total: fmt(reinvTotal + cashTotal),
      };
    }),
    totales: {
      reinversion_total: fmt(totalReinv),
      cash_total: fmt(totalCash),
      total: fmt(totalReinv + totalCash),
    },
  };
}

/**
 * Liquidaciones del mes agrupadas por modalidad de reinversión del inversionista
 * (`inversionistas.tipo_reinversion`). Por cada modalidad devuelve los campos
 * crudos de la liquidación (sumas, sin derivar ni restar nada):
 *   - `reinversion_total` → sección "Cuotas → Reinversión".
 *   - `total_capital` / `total_interes` / `total_iva` / `total_isr` / `total_cuota`
 *     → sección "Cuotas → A Recibir". (`total_iva` ya es el 12% del interés.)
 * Se filtra por `fecha_liquidacion` dentro del mes en zona America/Guatemala.
 * El etiquetado/omisión de modalidades se maneja en el front.
 */
export async function getReinversionLiquidaciones({
  mes,
  anio,
}: {
  mes: number;
  anio: number;
}) {
  const inicioMes = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const nextMonth = mes === 12 ? 1 : mes + 1;
  const nextYear = mes === 12 ? anio + 1 : anio;
  const inicioMesSiguiente = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  const result = await db.execute(sql`
    SELECT
      COALESCE(i.tipo_reinversion::text, 'sin_reinversion') AS tipo,
      COALESCE(SUM(l.reinversion_capital::numeric), 0)      AS reinversion_capital,
      COALESCE(SUM(l.reinversion_interes::numeric), 0)      AS reinversion_interes,
      COALESCE(SUM(l.reinversion_total::numeric), 0)        AS reinversion_total,
      COALESCE(SUM(l.total_capital::numeric), 0)            AS total_capital,
      COALESCE(SUM(l.total_interes::numeric), 0)            AS total_interes,
      COALESCE(SUM(l.total_iva::numeric), 0)                AS total_iva,
      COALESCE(SUM(l.total_isr::numeric), 0)                AS total_isr,
      COALESCE(SUM(l.total_cuota::numeric), 0)              AS total_cuota,
      COUNT(*)::int                                          AS cantidad
    FROM cartera.liquidaciones l
    JOIN cartera.inversionistas i ON l.inversionista_id = i.inversionista_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    GROUP BY i.tipo_reinversion
  `);

  const porTipo: Record<
    string,
    {
      reinversion_capital: string;
      reinversion_interes: string;
      reinversion_total: string;
      total_capital: string;
      total_interes: string;
      total_iva: string;
      total_isr: string;
      total_cuota: string;
    }
  > = {};
  let cantidad = 0;

  for (const r of result.rows as Record<string, unknown>[]) {
    const tipo = String(r.tipo ?? "sin_reinversion");
    porTipo[tipo] = {
      reinversion_capital: Number(r.reinversion_capital ?? 0).toFixed(2),
      reinversion_interes: Number(r.reinversion_interes ?? 0).toFixed(2),
      reinversion_total: Number(r.reinversion_total ?? 0).toFixed(2),
      total_capital: Number(r.total_capital ?? 0).toFixed(2),
      total_interes: Number(r.total_interes ?? 0).toFixed(2),
      total_iva: Number(r.total_iva ?? 0).toFixed(2),
      total_isr: Number(r.total_isr ?? 0).toFixed(2),
      total_cuota: Number(r.total_cuota ?? 0).toFixed(2),
    };
    cantidad += Number(r.cantidad ?? 0);
  }

  // Interés neto, agrupado según el tratamiento fiscal *guardado en la propia
  // liquidación* (no según el flag actual del inversionista, que puede cambiar
  // y reclasificaría meses históricos). Una liquidación sin factura es la que
  // tiene ISR retenido (`total_isr > 0`); las con factura tienen IVA y sin ISR.
  //   - Con factura:  neto = interés + IVA
  //   - Sin factura:  neto = interés − ISR
  const facturaRows = await db.execute(sql`
    SELECT
      (l.total_isr::numeric > 0)                   AS sin_factura,
      COALESCE(SUM(l.total_interes::numeric), 0)   AS total_interes,
      COALESCE(SUM(l.total_iva::numeric), 0)       AS total_iva,
      COALESCE(SUM(l.total_isr::numeric), 0)       AS total_isr
    FROM cartera.liquidaciones l
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    GROUP BY (l.total_isr::numeric > 0)
  `);

  const conFactura = { interes: 0, iva: 0 };
  const sinFactura = { interes: 0, isr: 0 };
  for (const r of facturaRows.rows as Record<string, unknown>[]) {
    const interes = Number(r.total_interes ?? 0);
    if (r.sin_factura === true) {
      sinFactura.interes += interes;
      sinFactura.isr += Number(r.total_isr ?? 0);
    } else {
      conFactura.interes += interes;
      conFactura.iva += Number(r.total_iva ?? 0);
    }
  }

  // Interés de CUBE: no se almacena como tal sino que se deriva de las filas de
  // los inversionistas no-CUBE en pagos_credito_inversionistas_espejo. Para una
  // fila con interés `abono_interes` y participación `porcentaje_participacion`,
  // el interés que le corresponde a CUBE (el complemento) es:
  //   interes_cube = abono_interes × (100 - porcentaje_participacion) / porcentaje_participacion
  // El cálculo se hace POR FILA, así
  // que no hay que combinar inversionistas por cuota. Calcular por fila además:
  //   - maneja pagos parciales (cada parcial aporta su complemento y se suman);
  //   - usa el porcentaje del snapshot de cada fila, por lo que sigue siendo
  //     correcto si la participación cambia entre cuotas (reasignación).
  // Se excluye la propia CUBE (inversionista_id 86) para no contar sus filas como
  // si fueran de un inversionista no-CUBE, y se omiten las filas al 100% (sin
  // complemento) y al 0% (evita división por cero).
  const cubeRows = await db.execute(sql`
    SELECT COALESCE(SUM(
      pe.abono_interes::numeric
        * (100 - pe.porcentaje_participacion::numeric)
        / pe.porcentaje_participacion::numeric
    ), 0) AS interes_cube
    FROM cartera.pagos_credito_inversionistas_espejo pe
    JOIN cartera.liquidaciones l ON l.liquidacion_id = pe.liquidacion_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
      AND pe.inversionista_id <> 86
      AND pe.porcentaje_participacion::numeric > 0
      AND pe.porcentaje_participacion::numeric < 100
  `);
  const interesCube = Number(
    (cubeRows.rows[0] as Record<string, unknown>)?.interes_cube ?? 0
  );

  // Pagos extras recibidos (abonos a capital / cancelaciones) que fluyen desde
  // las liquidaciones del mes: liquidación → pago espejo → abono.
  // Cada abono se cuenta una sola vez (DISTINCT) aunque tenga varios pagos espejo.
  const extrasRows = await db.execute(sql`
    SELECT a.tipo, COALESCE(SUM(a.monto::numeric), 0) AS total
    FROM cartera.abonos_capital a
    WHERE a.abono_id IN (
      SELECT DISTINCT e.abono_capital_id
      FROM cartera.pagos_credito_inversionistas_espejo e
      JOIN cartera.liquidaciones l ON l.liquidacion_id = e.liquidacion_id
      WHERE e.abono_capital_id IS NOT NULL
        AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
        AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    )
    GROUP BY a.tipo
  `);

  let abonosCapital = 0;
  let cancelaciones = 0;
  for (const r of extrasRows.rows as Record<string, unknown>[]) {
    if (r.tipo === "CAPITAL") abonosCapital = Number(r.total ?? 0);
    if (r.tipo === "CANCELACION") cancelaciones = Number(r.total ?? 0);
  }

  // Cancelaciones manuales: pagos del espejo (>= Q2,000) liquidados en el mes que
  // NO quedaron registrados en abonos_capital (abono_capital_id IS NULL) y cuyo
  // inversionista ya no tiene posición en el crédito (monto_aportado = 0 o ya no
  // existe la fila en creditos_inversionistas_espejo). Se excluyen créditos ACTIVO:
  // un saldo en 0 sobre un crédito vigente es anómalo / pago normal, no cancelación.
  // Se suman a las formales.
  const cancelExtraRows = await db.execute(sql`
    SELECT COALESCE(SUM(t.abono), 0) AS total
    FROM (
      SELECT
        SUM(pe.abono_capital::numeric)                 AS abono,
        COALESCE(MAX(ce.monto_aportado::numeric), 0)   AS monto_aportado,
        bool_and(ce.id IS NULL)                        AS sin_fila
      FROM cartera.pagos_credito_inversionistas_espejo pe
      JOIN cartera.liquidaciones l ON l.liquidacion_id = pe.liquidacion_id
      JOIN cartera.creditos cr ON cr.credito_id = pe.credito_id
      LEFT JOIN cartera.creditos_inversionistas_espejo ce
        ON ce.credito_id = pe.credito_id
       AND ce.inversionista_id = pe.inversionista_id
      WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
        AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
        AND pe.abono_capital::numeric >= 2000
        AND pe.abono_capital_id IS NULL
        AND cr."statusCredit" <> 'ACTIVO'
      GROUP BY pe.credito_id, pe.inversionista_id
    ) t
    WHERE t.monto_aportado = 0 OR t.sin_fila
  `);
  cancelaciones += Number(
    (cancelExtraRows.rows[0] as Record<string, unknown>)?.total ?? 0
  );

  // Desglose por inversionista (desde las liquidaciones del mes):
  //   - reinversion_capital / reinversion_interes / reinversion (total)
  //   - a_recibir = SUM(total_cuota)
  //   - monto_aportado = lo que le quedó al inversionista tras la liquidación
  const porInvRows = await db.execute(sql`
    SELECT
      l.inversionista_id,
      i.nombre,
      COALESCE(i.tipo_reinversion::text, 'sin_reinversion') AS tipo_reinversion,
      COALESCE(SUM(l.reinversion_capital::numeric), 0) AS reinversion_capital,
      COALESCE(SUM(l.reinversion_interes::numeric), 0) AS reinversion_interes,
      COALESCE(SUM(l.reinversion_total::numeric), 0)   AS reinversion,
      COALESCE(SUM(l.total_cuota::numeric), 0)         AS a_recibir
    FROM cartera.liquidaciones l
    JOIN cartera.inversionistas i ON l.inversionista_id = i.inversionista_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    GROUP BY l.inversionista_id, i.nombre, i.tipo_reinversion
    ORDER BY i.nombre
  `);

  // Monto aportado que le quedó al inversionista DESPUÉS de la liquidación
  // (sin reinversiones), desde historico_liquidaciones_espejo.
  // ⚠️ Mayo 2026 fue la primera vez que se usó y el histórico quedó CON la
  // reinversión sumada; para ese mes se descuenta la reinversión.
  const montoAportadoRows = await db.execute(sql`
    SELECT
      h.inversionista_id,
      COALESCE(SUM(h.monto_aportado::numeric), 0) AS monto_aportado
    FROM cartera.historico_liquidaciones_espejo h
    JOIN cartera.liquidaciones l ON l.liquidacion_id = h.liquidacion_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    GROUP BY h.inversionista_id
  `);
  const montoAportadoPorInv = new Map<number, number>();
  for (const r of montoAportadoRows.rows as Record<string, unknown>[]) {
    montoAportadoPorInv.set(
      Number(r.inversionista_id),
      Number(r.monto_aportado ?? 0)
    );
  }
  const esMayo2026 = anio === 2026 && mes === 5;

  const porInversionista = (porInvRows.rows as Record<string, unknown>[]).map(
    (r) => {
      const id = Number(r.inversionista_id);
      const reinversion = Number(r.reinversion ?? 0);
      const montoHist = montoAportadoPorInv.get(id) ?? 0;
      const montoAportado = esMayo2026 ? montoHist - reinversion : montoHist;
      return {
        inversionista_id: id,
        nombre: String(r.nombre),
        tipo_reinversion: String(r.tipo_reinversion ?? "sin_reinversion"),
        reinversion_capital: Number(r.reinversion_capital ?? 0).toFixed(2),
        reinversion_interes: Number(r.reinversion_interes ?? 0).toFixed(2),
        reinversion: reinversion.toFixed(2),
        a_recibir: Number(r.a_recibir ?? 0).toFixed(2),
        monto_aportado: montoAportado.toFixed(2),
      };
    }
  ).filter(
    // La liquidación manda: si no aportó nada (todo en cero), no se muestra.
    (p) =>
      Number(p.reinversion) !== 0 ||
      Number(p.a_recibir) !== 0 ||
      Number(p.monto_aportado) !== 0
  );

  // Compras del mes: solo operación de compra (no reinversión) y solo las
  // COMPLETADAS (status = 'completado'); las pendientes no se cuentan. La fecha
  // efectiva prioriza fecha_completada y cae a updated_at cuando es NULL
  // (columna nueva, registros viejos) — mismo criterio que utils/comprasAjuste.ts.
  const fechaCompra = sql`COALESCE(c.fecha_completada, c.updated_at)`;
  const comprasRows = await db.execute(sql`
    SELECT
      COALESCE(c.tipo_reinversion::text, 'sin_reinversion') AS tipo,
      COUNT(DISTINCT (c.inversionista_id, ${fechaCompra}))::int AS cantidad,
      COALESCE(SUM(c.monto_aportado::numeric), 0) AS monto
    FROM cartera.compras_credito_inversionista c
    WHERE c.tipo_operacion = 'compra_cartera'
      AND c.status = 'completado'
      AND (${fechaCompra} AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (${fechaCompra} AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    GROUP BY c.tipo_reinversion
    ORDER BY monto DESC
  `);
  const comprasMes = (comprasRows.rows as Record<string, unknown>[]).map(
    (r) => ({
      tipo: String(r.tipo ?? "sin_reinversion"),
      cantidad: Number(r.cantidad ?? 0),
      monto: Number(r.monto ?? 0).toFixed(2),
    })
  );

  return {
    porTipo,
    porInversionista,
    comprasMes,
    interesNeto: {
      conFactura: {
        interes: conFactura.interes.toFixed(2),
        iva: conFactura.iva.toFixed(2),
        neto: (conFactura.interes + conFactura.iva).toFixed(2),
      },
      sinFactura: {
        interes: sinFactura.interes.toFixed(2),
        isr: sinFactura.isr.toFixed(2),
        neto: (sinFactura.interes - sinFactura.isr).toFixed(2),
      },
      cube: {
        interes: interesCube.toFixed(2),
        iva: (interesCube * 0.12).toFixed(2),
        neto: (interesCube * 1.12).toFixed(2),
      },
    },
    pagosExtras: {
      abonos_capital: abonosCapital.toFixed(2),
      cancelaciones: cancelaciones.toFixed(2),
    },
    cantidad_liquidaciones: cantidad,
  };
}

export async function getEsperadoDelMes({
  mes,
  anio,
}: {
  mes: number;
  anio: number;
}) {
  // fecha_vencimiento is a DATE column — use date range, no timezone needed.
  const inicioMes = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const nextMonth = mes === 12 ? 1 : mes + 1;
  const nextYear = mes === 12 ? anio + 1 : anio;
  const inicioMesSiguiente = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(cr.cuota::numeric - cr.cuota_interes::numeric - cr.iva_12::numeric - cr.seguro_10_cuotas::numeric - cr.gps::numeric - cr.membresias_pago::numeric), 0) AS esperado_capital,
      COALESCE(SUM(cr.cuota_interes::numeric), 0) AS esperado_interes,
      COALESCE(SUM(cr.iva_12::numeric), 0) AS esperado_iva,
      COALESCE(SUM(cr.seguro_10_cuotas::numeric), 0) AS esperado_seguro,
      COALESCE(SUM(cr.gps::numeric), 0) AS esperado_gps,
      COALESCE(SUM(cr.membresias_pago::numeric), 0) AS esperado_membresias
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    WHERE c.fecha_vencimiento >= ${inicioMes}::date
      AND c.fecha_vencimiento < ${inicioMesSiguiente}::date
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    esperado_capital: String(row?.esperado_capital ?? "0"),
    esperado_interes: String(row?.esperado_interes ?? "0"),
    esperado_iva: String(row?.esperado_iva ?? "0"),
    esperado_seguro: String(row?.esperado_seguro ?? "0"),
    esperado_gps: String(row?.esperado_gps ?? "0"),
    esperado_membresias: String(row?.esperado_membresias ?? "0"),
  };
}

export async function getColocacionPorPeriodo({
  periodo,
  fechaInicio,
  fechaFin,
}: {
  periodo: Periodo;
  fechaInicio: string;
  fechaFin: string;
}) {
  const pg = sql.raw(toPostgresPeriod[periodo]);

  const result = await db.execute(sql`
    SELECT
      DATE_TRUNC(${pg}, (cr.fecha_creacion AT TIME ZONE 'America/Guatemala')::timestamp) AS bucket,
      COUNT(cr.credito_id)::int AS cantidad_creditos,
      COALESCE(SUM(cr.capital::numeric), 0) AS total_colocacion
    FROM cartera.creditos cr
    WHERE (cr.fecha_creacion AT TIME ZONE 'America/Guatemala')::date >= ${fechaInicio}::date
      AND (cr.fecha_creacion AT TIME ZONE 'America/Guatemala')::date <= ${fechaFin}::date
    GROUP BY DATE_TRUNC(${pg}, (cr.fecha_creacion AT TIME ZONE 'America/Guatemala')::timestamp)
    ORDER BY bucket ASC
  `);

  return result.rows;
}

export async function getComparativoHistorico({ anio }: { anio: number }) {
  // Guatemala es UTC-6 fijo (sin DST): medianoche GT = 06:00 UTC.
  const inicioAnioUtc = new Date(Date.UTC(anio, 0, 1, 6)).toISOString();
  const finAnioUtc = new Date(Date.UTC(anio + 1, 0, 1, 6)).toISOString();

  // a) Facturación por mes: último acumulado_total del mes en facturacion_snapshot_diario.
  //    acumulado_total es running total del mes → el último registro = total del mes.
  const cobrado = await db.execute(sql`
    SELECT DISTINCT ON (mes)
      mes,
      acumulado_total AS cobrado
    FROM cartera.facturacion_snapshot_diario
    WHERE anio = ${anio}
    ORDER BY mes, fecha DESC
  `);

  // b) Cartera activa al cierre de cada mes desde cierre_mensual,
  //    sumando solo ACTIVO + MOROSO + EN_CONVENIO.
  const cartera = await db.execute(sql`
    SELECT
      periodo AS mes,
      COALESCE(SUM(cantidad_creditos), 0)::int AS creditos_activos,
      COALESCE(SUM(capital_total::numeric), 0) AS cartera_activa
    FROM cartera.cierre_mensual
    WHERE periodo >= make_date(${anio}, 1, 1)
      AND periodo < make_date(${anio + 1}, 1, 1)
      AND status_credit IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
    GROUP BY periodo
    ORDER BY periodo
  `);

  // c) Mora actual por bucket (mes corriente): moras_credito agrupada por cuotas_atrasadas.
  const moraActual = await db.execute(sql`
    SELECT
      CASE
        WHEN m.cuotas_atrasadas >= 4 THEN '120'
        WHEN m.cuotas_atrasadas = 3  THEN '90'
        WHEN m.cuotas_atrasadas = 2  THEN '60'
        ELSE '30'
      END AS bucket,
      COUNT(DISTINCT m.credito_id)::int AS cantidad_creditos,
      COALESCE(SUM(m.monto_mora::numeric), 0) AS monto_mora
    FROM cartera.moras_credito m
    WHERE m.activa = true
    GROUP BY 1
  `);

  // d) Aging histórico desde cierre_mora_aging.
  const agingHistorico = await db.execute(sql`
    SELECT
      periodo,
      bucket,
      cantidad_creditos,
      monto_mora
    FROM cartera.cierre_mora_aging
    WHERE periodo >= make_date(${anio}, 1, 1)
      AND periodo < make_date(${anio + 1}, 1, 1)
    ORDER BY periodo, bucket
  `);

  return {
    cobrado: cobrado.rows,
    cartera: cartera.rows,
    moraActual: moraActual.rows,
    agingHistorico: agingHistorico.rows,
  };
}

type BucketAcc = { cantidad: number; sumaCapital: number; sumaMora: number };
type BucketsAcc = { mora_30: BucketAcc; mora_60: BucketAcc; mora_90: BucketAcc; mora_120_plus: BucketAcc };

function emptyBuckets(): BucketsAcc {
  return {
    mora_30: { cantidad: 0, sumaCapital: 0, sumaMora: 0 },
    mora_60: { cantidad: 0, sumaCapital: 0, sumaMora: 0 },
    mora_90: { cantidad: 0, sumaCapital: 0, sumaMora: 0 },
    mora_120_plus: { cantidad: 0, sumaCapital: 0, sumaMora: 0 },
  };
}

function serializeBuckets(b: BucketsAcc) {
  const fmt = (n: number) => n.toFixed(2);
  const totalCantidad = b.mora_30.cantidad + b.mora_60.cantidad + b.mora_90.cantidad + b.mora_120_plus.cantidad;
  const totalMora = b.mora_30.sumaMora + b.mora_60.sumaMora + b.mora_90.sumaMora + b.mora_120_plus.sumaMora;
  return {
    mora_30: { cantidad: b.mora_30.cantidad, sumaCapital: fmt(b.mora_30.sumaCapital), sumaMora: fmt(b.mora_30.sumaMora) },
    mora_60: { cantidad: b.mora_60.cantidad, sumaCapital: fmt(b.mora_60.sumaCapital), sumaMora: fmt(b.mora_60.sumaMora) },
    mora_90: { cantidad: b.mora_90.cantidad, sumaCapital: fmt(b.mora_90.sumaCapital), sumaMora: fmt(b.mora_90.sumaMora) },
    mora_120_plus: { cantidad: b.mora_120_plus.cantidad, sumaCapital: fmt(b.mora_120_plus.sumaCapital), sumaMora: fmt(b.mora_120_plus.sumaMora) },
    totalEnMora: { cantidad: totalCantidad, sumaMora: fmt(totalMora) },
  };
}

type MoraRow = {
  asesor_id: number;
  nombre: string;
  email_asesor: string | null;
  bucket: keyof BucketsAcc;
  cantidad: number;
  suma_capital: string;
  suma_mora: string;
};

function acumularBuckets(rows: MoraRow[]) {
  const totalAcc = emptyBuckets();
  const asesorMap = new Map<number, { asesorId: number; nombre: string; email: string; acc: BucketsAcc }>();
  for (const row of rows) {
    const bucket = row.bucket;
    const cantidad = row.cantidad;
    const sumaCapital = Number(row.suma_capital);
    const sumaMora = Number(row.suma_mora);
    totalAcc[bucket].cantidad += cantidad;
    totalAcc[bucket].sumaCapital += sumaCapital;
    totalAcc[bucket].sumaMora += sumaMora;
    if (!asesorMap.has(row.asesor_id)) {
      asesorMap.set(row.asesor_id, { asesorId: row.asesor_id, nombre: row.nombre, email: row.email_asesor ?? "", acc: emptyBuckets() });
    }
    const entry = asesorMap.get(row.asesor_id)!;
    entry.acc[bucket].cantidad += cantidad;
    entry.acc[bucket].sumaCapital += sumaCapital;
    entry.acc[bucket].sumaMora += sumaMora;
  }
  const porAsesor = Array.from(asesorMap.values())
    .sort((a, b) => {
      const tA = a.acc.mora_30.sumaMora + a.acc.mora_60.sumaMora + a.acc.mora_90.sumaMora + a.acc.mora_120_plus.sumaMora;
      const tB = b.acc.mora_30.sumaMora + b.acc.mora_60.sumaMora + b.acc.mora_90.sumaMora + b.acc.mora_120_plus.sumaMora;
      return tB - tA;
    })
    .map((e) => ({ asesorId: e.asesorId, nombre: e.nombre, email: e.email, ...serializeBuckets(e.acc) }));
  return { totales: serializeBuckets(totalAcc), porAsesor };
}

function hoyGTStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

export async function getMoraByEtapaYAsesor({
  emailCobrador,
  fecha,
  asesores,
}: { emailCobrador?: string; fecha?: string; asesores?: number[] } = {}) {
  const hoy = hoyGTStr();
  const usarHistorico = !!fecha && fecha < hoy;

  const emailFilter = emailCobrador
    ? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
    : sql``;
  const asesoresFilter = asesores && asesores.length
    ? sql`AND a.asesor_id IN (${sql.join(asesores.map((id) => sql`${id}`), sql`, `)})`
    : sql``;

  if (!usarHistorico) {
    const rows = await db.execute<MoraRow>(sql`
      WITH mora_activa AS (
        SELECT DISTINCT ON (credito_id)
          credito_id, cuotas_atrasadas, monto_mora
        FROM cartera.moras_credito
        WHERE activa = true AND cuotas_atrasadas > 0
        ORDER BY credito_id, mora_id DESC
      )
      SELECT
        a.asesor_id, a.nombre, a.email_cash_in AS email_asesor,
        CASE
          WHEN m.cuotas_atrasadas >= 4 THEN 'mora_120_plus'
          WHEN m.cuotas_atrasadas = 3  THEN 'mora_90'
          WHEN m.cuotas_atrasadas = 2  THEN 'mora_60'
          ELSE                              'mora_30'
        END AS bucket,
        COUNT(*)::int AS cantidad,
        COALESCE(SUM(c.capital::numeric), 0) AS suma_capital,
        COALESCE(SUM(m.monto_mora::numeric), 0) AS suma_mora
      FROM mora_activa m
      INNER JOIN cartera.creditos c ON c.credito_id = m.credito_id
      INNER JOIN cartera.asesores a ON a.asesor_id  = c.asesor_id
      WHERE c."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
        ${emailFilter}
        ${asesoresFilter}
      GROUP BY a.asesor_id, a.nombre, a.email_cash_in, bucket
    `);
    return { ...acumularBuckets(rows.rows), fecha: hoy, alcance: "live" as const };
  }

  const rows = await db.execute<MoraRow>(sql`
    WITH ${snapCte(fecha!)}
    SELECT
      a.asesor_id, a.nombre, a.email_cash_in AS email_asesor,
      CASE
        WHEN s.cuotas >= 4 THEN 'mora_120_plus'
        WHEN s.cuotas = 3  THEN 'mora_90'
        WHEN s.cuotas = 2  THEN 'mora_60'
        ELSE                    'mora_30'
      END AS bucket,
      COUNT(*)::int AS cantidad,
      COALESCE(SUM(c.capital::numeric), 0) AS suma_capital,
      COALESCE(SUM(s.monto), 0) AS suma_mora
    FROM snap s
    INNER JOIN cartera.creditos c ON c.credito_id = s.credito_id
    INNER JOIN cartera.asesores a ON a.asesor_id  = c.asesor_id
    WHERE s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0
      ${emailFilter}
      ${asesoresFilter}
    GROUP BY a.asesor_id, a.nombre, a.email_cash_in, bucket
  `);

  const result = acumularBuckets(rows.rows);
  if (!result.porAsesor.length) {
    const minRes = await db.execute<{ min_fecha: string | null }>(sql`
      SELECT MIN((fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date)::text AS min_fecha
      FROM cartera.moras_historial
    `);
    const minFecha = minRes.rows[0]?.min_fecha ?? null;
    if (minFecha && fecha! < minFecha) {
      return { ...result, fecha, alcance: "historico" as const, dataDisponibleDesde: minFecha };
    }
  }
  return { ...result, fecha, alcance: "historico" as const };
}

export async function getCuotasPorFecha({
  fechaInicio,
  fechaFin,
  asesorId,
}: {
  fechaInicio: string;
  fechaFin: string;
  asesorId?: number;
}) {
  const asesorFilter = asesorId
    ? sql`AND cr.asesor_id = ${asesorId}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      c.cuota_id,
      c.numero_cuota,
      c.fecha_vencimiento,
      c.pagado,
      cr.credito_id,
      cr.numero_credito_sifco,
      u.nombre            AS cliente_nombre,
      a.nombre            AS asesor_nombre,
      a.email_cash_in     AS asesor_email,
      cr."statusCredit",
      -- Capital from amortization: prev cuota total_restante - current cuota total_restante
      CASE
        WHEN prev_pag.total_restante IS NOT NULL AND curr_pag.total_restante IS NOT NULL
        THEN prev_pag.total_restante - curr_pag.total_restante
        ELSE COALESCE(cr.cuota::numeric
          - cr.cuota_interes::numeric
          - cr.iva_12::numeric
          - COALESCE(cr.seguro_10_cuotas::numeric, 0)
          - COALESCE(cr.gps::numeric, 0)
          - COALESCE(cr.membresias_pago::numeric, 0), 0)
      END AS capital_esperado,
      -- Interes from amortization: (cuota - capital - seguro - gps - membresias) * 100/112
      CASE
        WHEN prev_pag.total_restante IS NOT NULL AND curr_pag.total_restante IS NOT NULL
        THEN GREATEST(0, (
          cr.cuota::numeric
          - (prev_pag.total_restante - curr_pag.total_restante)
          - COALESCE(cr.seguro_10_cuotas::numeric, 0)
          - COALESCE(cr.gps::numeric, 0)
          - COALESCE(cr.membresias_pago::numeric, 0)
        ) * 100.0 / 112.0)
        ELSE COALESCE(cr.cuota_interes::numeric, 0)
      END AS interes_esperado,
      -- IVA from amortization: (cuota - capital - seguro - gps - membresias) * 12/112
      CASE
        WHEN prev_pag.total_restante IS NOT NULL AND curr_pag.total_restante IS NOT NULL
        THEN GREATEST(0, (
          cr.cuota::numeric
          - (prev_pag.total_restante - curr_pag.total_restante)
          - COALESCE(cr.seguro_10_cuotas::numeric, 0)
          - COALESCE(cr.gps::numeric, 0)
          - COALESCE(cr.membresias_pago::numeric, 0)
        ) * 12.0 / 112.0)
        ELSE COALESCE(cr.iva_12::numeric, 0)
      END AS iva_esperado,
      COALESCE(cr.seguro_10_cuotas::numeric, 0)       AS seguro_esperado,
      COALESCE(cr.gps::numeric, 0)                    AS gps_esperado,
      COALESCE(cr.membresias_pago::numeric, 0)        AS membresias_esperado,
      COALESCE(cr.cuota::numeric, 0)                  AS total_esperado,
      COALESCE(pag.abono_capital, 0)                  AS capital_pagado,
      COALESCE(pag.abono_interes, 0)                  AS interes_pagado,
      COALESCE(pag.abono_iva, 0)                      AS iva_pagado,
      COALESCE(pag.abono_seguro, 0)                   AS seguro_pagado,
      COALESCE(pag.abono_gps, 0)                      AS gps_pagado,
      COALESCE(pag.membresias_pagada, 0)              AS membresias_pagado,
      COALESCE(pag.total_pagado, 0)                   AS total_pagado
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    JOIN cartera.usuarios u  ON cr.usuario_id = u.usuario_id
    LEFT JOIN cartera.asesores a ON cr.asesor_id = a.asesor_id
    LEFT JOIN LATERAL (
      SELECT MAX(pc_prev.total_restante::numeric) AS total_restante
      FROM cartera.pagos_credito pc_prev
      JOIN cartera.cuotas_credito qc_prev ON pc_prev.cuota_id = qc_prev.cuota_id
      WHERE qc_prev.credito_id = c.credito_id
        AND qc_prev.numero_cuota = c.numero_cuota - 1
        AND qc_prev.numero_cuota > 0
        AND pc_prev."paymentFalse" = false
        AND pc_prev.monto_aplicado IS NOT NULL
        AND pc_prev.monto_aplicado::numeric > 0
    ) prev_pag ON true
    LEFT JOIN LATERAL (
      SELECT MAX(pc_curr.total_restante::numeric) AS total_restante
      FROM cartera.pagos_credito pc_curr
      WHERE pc_curr.cuota_id = c.cuota_id
        AND pc_curr."paymentFalse" = false
        AND pc_curr.monto_aplicado IS NOT NULL
        AND pc_curr.monto_aplicado::numeric > 0
    ) curr_pag ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(pc.abono_capital::numeric)    AS abono_capital,
        SUM(pc.abono_interes::numeric)    AS abono_interes,
        SUM(pc.abono_iva_12::numeric)     AS abono_iva,
        SUM(pc.abono_seguro::numeric)     AS abono_seguro,
        SUM(pc.abono_gps::numeric)        AS abono_gps,
        SUM(pc.membresias_pago::numeric)  AS membresias_pagada,
        SUM(
          COALESCE(pc.abono_capital::numeric, 0)
          + COALESCE(pc.abono_interes::numeric, 0)
          + COALESCE(pc.abono_iva_12::numeric, 0)
          + COALESCE(pc.abono_seguro::numeric, 0)
          + COALESCE(pc.abono_gps::numeric, 0)
          + COALESCE(pc.membresias_pago::numeric, 0)
        ) AS total_pagado
      FROM cartera.pagos_credito pc
      WHERE pc.cuota_id = c.cuota_id
        AND pc."paymentFalse" = false
    ) pag ON true
    WHERE c.fecha_vencimiento::date >= ${fechaInicio}::date
      AND c.fecha_vencimiento::date <= ${fechaFin}::date
      AND c.numero_cuota > 0
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
      ${asesorFilter}
    ORDER BY c.fecha_vencimiento ASC, cr.numero_credito_sifco ASC
  `);

  return result.rows;
}
