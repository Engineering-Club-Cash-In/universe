import { sql } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import {
	type MoraRecoverySourceRow,
	buildMoraRecoveryQuery,
	buildMoraRecoveryReport,
	getMoraRecoveryPeriod,
} from "./moraRecuperacion";
import {
  buildCapitalCarteraQuery,
  creditosElegiblesMoraSql,
} from "./moraCapitalCartera";
import { snapCte } from "./moraSnapshotSql";
import {
  buildInteresIvaInversionistaSql,
  participacionExternaActualCteSql,
} from "./monto-a-cobrar-participacion-sql";
import {
  allocateRoundedAmounts,
  allocateRoundedPurchaseAmounts,
	aggregateInvestorLiquidationRows,
	assertLiquidationRowsReinvestmentIntegrity,
	canonicalizeLiquidationModeRows,
	buildLiquidationComposition,
	buildPurchaseTicketHistory,
	calculateActiveCapital,
	assertModeReconciliation,
	assertReportReconciliation,
  buildCubeNetInterest,
  buildNetInterestDetail,
	getPublicReinvestmentDetailError,
	normalizeReinvestmentComponents,
	summarizePurchaseDetails,
	shouldIncludeInvestorPosition,
} from "./reinvestmentReport";

type Periodo = "anio" | "trimestre" | "mes" | "semana" | "dia";

const numericMoney = (value: unknown) => new Big(String(value ?? 0)).toFixed(2);

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
    ${sql.raw(participacionExternaActualCteSql)},
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
        COALESCE(MAX(pea.factor_capital_inversionista), 0)              AS factor_capital_inversionista,
        COALESCE(MAX(pea.factor_interes_iva_inversionista), 0)          AS factor_interes_iva_inversionista,
        COALESCE(BOOL_OR(pea.participacion_invalida), false)            AS participacion_invalida,
        COALESCE(cap_anterior.total_restante, c.capital::numeric)       AS cap_ant,
        MAX(mora_real.cuotas_atrasadas)                                 AS cuotas_atrasadas,
        CASE WHEN MAX(mora_real.cuotas_atrasadas) > 0
             THEN COALESCE(MAX(hist_mora.monto_mora), 0)
             ELSE 0 END                                                 AS mora_val
      FROM pagos_en_rango p
      INNER JOIN cartera.creditos c ON p.credito_id = c.credito_id
      INNER JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
      INNER JOIN cartera.asesores a ON c.asesor_id = a.asesor_id
      LEFT JOIN participacion_externa_actual pea ON pea.credito_id = c.credito_id
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
        MAX(factor_capital_inversionista)        AS factor_capital_inversionista,
        MAX(factor_interes_iva_inversionista)    AS factor_interes_iva_inversionista,
        BOOL_OR(participacion_invalida)          AS participacion_invalida,
        COUNT(*)::int                           AS cuotas_count
      FROM calc_acum
      GROUP BY DATE_TRUNC(${pg}, bucket::timestamp), credito_id
    ),
    split_participacion_actual AS (
      SELECT
        pbc.*,
        ROUND((CASE WHEN NOT excluido_factura THEN exp_capital ELSE 0 END) * factor_capital_inversionista, 2) AS capital_inv_participacion_actual,
        (CASE WHEN NOT excluido_factura THEN exp_capital ELSE 0 END) - ROUND((CASE WHEN NOT excluido_factura THEN exp_capital ELSE 0 END) * factor_capital_inversionista, 2) AS capital_cube_participacion_actual,
        CASE WHEN NOT excluido_factura THEN ${sql.raw(buildInteresIvaInversionistaSql("interes", "iva", "pbc.credito_id"))} ELSE 0 END AS interes_iva_inv_participacion_actual,
        CASE WHEN NOT excluido_factura THEN interes + iva - ${sql.raw(buildInteresIvaInversionistaSql("interes", "iva", "pbc.credito_id"))} ELSE 0 END AS interes_iva_cube_participacion_actual,
        ROUND((CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN LEAST(acum_capital, cap_ant) ELSE exp_capital END) * factor_capital_inversionista, 2) AS acum_capital_inv_participacion_actual,
        (CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN LEAST(acum_capital, cap_ant) ELSE exp_capital END) - ROUND((CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN LEAST(acum_capital, cap_ant) ELSE exp_capital END) * factor_capital_inversionista, 2) AS acum_capital_cube_participacion_actual,
        ${sql.raw(buildInteresIvaInversionistaSql("CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN acum_interes ELSE interes END", "CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN acum_iva ELSE iva END", "pbc.credito_id"))} AS acum_interes_iva_inv_participacion_actual,
        (CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN acum_interes + acum_iva ELSE interes + iva END) - ${sql.raw(buildInteresIvaInversionistaSql("CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN acum_interes ELSE interes END", "CASE WHEN excluido_mora THEN 0 WHEN cuotas_atrasadas > 0 THEN acum_iva ELSE iva END", "pbc.credito_id"))} AS acum_interes_iva_cube_participacion_actual
      FROM per_bucket_credit pbc
    ),
    participacion_invalida_rango AS (
      SELECT COUNT(DISTINCT credito_id) FILTER (WHERE participacion_invalida)::int AS creditos_participacion_invalida_rango
      FROM split_participacion_actual
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
      COALESCE(split_participacion_actual.bucket, ip.pagos_bucket) AS bucket,
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
      COALESCE(SUM(COALESCE(MAX(ip.total_interes_inversionista), 0)) OVER (ORDER BY COALESCE(split_participacion_actual.bucket, ip.pagos_bucket)), 0)   AS acum_total_interes_inversionista,
    -- FULL JOIN: el resultado se arma desde la unión de buckets de ambas fuentes, para que un
    -- período con pagos a inversionistas pero SIN cuotas pendientes (posible en vista
    -- día/semana) no se pierda ni subestime la columna.
      COALESCE(SUM(capital_inv_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS capital_inv_participacion_actual,
      COALESCE(SUM(capital_cube_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS capital_cube_participacion_actual,
      COALESCE(SUM(interes_iva_inv_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS interes_iva_inv_participacion_actual,
      COALESCE(SUM(interes_iva_cube_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS interes_iva_cube_participacion_actual,
      COALESCE(SUM(acum_capital_inv_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS acum_capital_inv_participacion_actual,
      COALESCE(SUM(acum_capital_cube_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS acum_capital_cube_participacion_actual,
      COALESCE(SUM(acum_interes_iva_inv_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS acum_interes_iva_inv_participacion_actual,
      COALESCE(SUM(acum_interes_iva_cube_participacion_actual) FILTER (WHERE NOT participacion_invalida), 0) AS acum_interes_iva_cube_participacion_actual,
      COUNT(credito_id) FILTER (WHERE participacion_invalida)::int AS creditos_participacion_invalida,
      COALESCE(MAX(pir.creditos_participacion_invalida_rango), 0)::int AS creditos_participacion_invalida_rango,
      COALESCE(SUM(cuotas_count) FILTER (WHERE participacion_invalida), 0)::int AS cuotas_participacion_invalida,
      true AS participacion_actual
    FROM split_participacion_actual
    FULL JOIN inv_pagos_por_bucket ip ON ip.pagos_bucket = split_participacion_actual.bucket
    CROSS JOIN participacion_invalida_rango pir
    GROUP BY COALESCE(split_participacion_actual.bucket, ip.pagos_bucket)
    ORDER BY COALESCE(split_participacion_actual.bucket, ip.pagos_bucket) ASC
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

  // Valida cada liquidación antes de cualquier GROUP BY o asignación residual:
  // una sobreasignación material no puede compensarse con otra fila y parecer
  // una deriva agregada de un centavo.
  const integrityRows = await db.execute(sql`
    SELECT reinversion_capital, reinversion_interes, reinversion_total
    FROM cartera.liquidaciones
    WHERE (fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
  `);
  assertLiquidationRowsReinvestmentIntegrity(
    (integrityRows.rows as Record<string, unknown>[]).map((row) => ({
      reinvestedCapital: String(row.reinversion_capital ?? 0),
      reinvestedRest: String(row.reinversion_interes ?? 0),
      reinvestedTotal: String(row.reinversion_total ?? 0),
    })),
  );

  const result = await db.execute(sql`
    WITH liquidaciones_mes AS (
      SELECT
        l.*,
        CASE
          WHEN ROUND(l.reinversion_total::numeric, 2)
            - ROUND(l.reinversion_capital::numeric, 2)
            - ROUND(l.reinversion_interes::numeric, 2) = -0.01
            AND ROUND(l.reinversion_interes::numeric, 2) > 0
            THEN ROUND(l.reinversion_interes::numeric, 2) - 0.01
          ELSE ROUND(l.reinversion_interes::numeric, 2)
        END AS reinversion_interes_report,
        CASE
          WHEN ROUND(l.reinversion_total::numeric, 2)
            - ROUND(l.reinversion_capital::numeric, 2)
            - ROUND(l.reinversion_interes::numeric, 2) = -0.01
            AND ROUND(l.reinversion_interes::numeric, 2) = 0
            AND ROUND(l.reinversion_capital::numeric, 2) > 0
            THEN ROUND(l.reinversion_capital::numeric, 2) - 0.01
          ELSE ROUND(l.reinversion_capital::numeric, 2)
        END AS reinversion_capital_report,
        ROUND(l.reinversion_total::numeric, 2) AS reinversion_total_report
      FROM cartera.liquidaciones l
      WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
        AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    ),
    snapshots AS (
      SELECT
        h.liquidacion_id,
        h.credito_id,
        MIN(h.tipo_reinversion_snapshot::text) AS tipo
      FROM cartera.historico_liquidaciones_espejo h
      JOIN liquidaciones_mes l ON l.liquidacion_id = h.liquidacion_id
      GROUP BY h.liquidacion_id, h.credito_id
    ),
    pesos_mixtos AS (
      SELECT
        l.liquidacion_id,
        COALESCE(s.tipo, 'sin_clasificar') AS tipo,
        COALESCE(SUM(pe.abono_capital::numeric), 0) AS peso_capital,
        COALESCE(SUM(pe.abono_interes::numeric), 0) AS peso_interes,
        COALESCE(SUM(
          pe.abono_capital::numeric
          + pe.abono_interes::numeric
          + CASE
              WHEN l.descuenta_impuestos = true OR l.total_isr::numeric > 0
                THEN -(pe.abono_interes::numeric * 0.07)
              ELSE pe.abono_iva_12::numeric
            END
        ), 0) AS peso_flujo
      FROM liquidaciones_mes l
      JOIN cartera.pagos_credito_inversionistas_espejo pe
        ON pe.liquidacion_id = l.liquidacion_id
      LEFT JOIN snapshots s
        ON s.liquidacion_id = pe.liquidacion_id
       AND s.credito_id = pe.credito_id
      WHERE l.tipo_reinversion_snapshot IS NULL
      GROUP BY l.liquidacion_id, COALESCE(s.tipo, 'sin_clasificar')
    ),
    pesos AS (
      SELECT
        l.*,
        l.tipo_reinversion_snapshot::text AS tipo,
        l.total_capital::numeric AS peso_capital,
        l.total_interes::numeric AS peso_interes,
        (l.total_cuota::numeric + l.reinversion_total::numeric) AS peso_flujo
      FROM liquidaciones_mes l
      WHERE l.tipo_reinversion_snapshot IS NOT NULL

      UNION ALL

      SELECT
        l.*,
        p.tipo,
        p.peso_capital,
        p.peso_interes,
        p.peso_flujo
      FROM liquidaciones_mes l
      JOIN pesos_mixtos p ON p.liquidacion_id = l.liquidacion_id
      WHERE l.tipo_reinversion_snapshot IS NULL
    ),
    denominadores AS (
      SELECT
        p.*,
        COUNT(*) OVER liquidacion AS cantidad_modos,
        SUM(p.peso_capital) OVER liquidacion AS peso_capital_total,
        SUM(p.peso_interes) OVER liquidacion AS peso_interes_total,
        SUM(p.peso_flujo) OVER liquidacion AS peso_flujo_total,
        SUM(p.peso_capital) FILTER (
          WHERE p.tipo IN ('reinversion_capital', 'reinversion_total')
        ) OVER liquidacion AS peso_reinv_capital,
        SUM(p.peso_interes) FILTER (
          WHERE p.tipo IN ('reinversion_interes', 'reinversion_total')
        ) OVER liquidacion AS peso_reinv_interes,
        COUNT(*) FILTER (
          WHERE p.tipo IN ('reinversion_variable', 'reinversion_excedente')
        ) OVER liquidacion AS cantidad_modos_variables
      FROM pesos p
      WINDOW liquidacion AS (PARTITION BY p.liquidacion_id)
    ),
    asignacion_base AS (
      SELECT
        d.*,
        CASE
          WHEN d.cantidad_modos = 1 THEN d.total_capital::numeric
          WHEN d.peso_capital_total = 0 THEN d.total_capital::numeric / d.cantidad_modos
          ELSE d.total_capital::numeric * d.peso_capital / d.peso_capital_total
        END AS total_capital_modo,
        CASE
          WHEN d.cantidad_modos = 1 THEN d.total_interes::numeric
          WHEN d.peso_interes_total = 0 THEN d.total_interes::numeric / d.cantidad_modos
          ELSE d.total_interes::numeric * d.peso_interes / d.peso_interes_total
        END AS total_interes_modo,
        CASE
          WHEN d.cantidad_modos = 1 THEN d.total_iva::numeric
          WHEN d.peso_interes_total = 0 THEN d.total_iva::numeric / d.cantidad_modos
          ELSE d.total_iva::numeric * d.peso_interes / d.peso_interes_total
        END AS total_iva_modo,
        CASE
          WHEN d.cantidad_modos = 1 THEN d.total_isr::numeric
          WHEN d.peso_interes_total = 0 THEN d.total_isr::numeric / d.cantidad_modos
          ELSE d.total_isr::numeric * d.peso_interes / d.peso_interes_total
        END AS total_isr_modo,
        CASE
          WHEN d.cantidad_modos = 1 THEN d.total_cuota::numeric + d.reinversion_total::numeric
          WHEN d.peso_flujo_total = 0
            THEN (d.total_cuota::numeric + d.reinversion_total::numeric) / d.cantidad_modos
          ELSE (d.total_cuota::numeric + d.reinversion_total::numeric)
            * d.peso_flujo / d.peso_flujo_total
        END AS total_distribuido_modo,
        CASE
          WHEN d.tipo IN ('reinversion_capital', 'reinversion_total')
            AND d.peso_reinv_capital > 0
            THEN d.reinversion_capital_report * d.peso_capital / d.peso_reinv_capital
          ELSE 0
        END AS reinversion_capital_modo,
        CASE
          WHEN d.tipo IN ('reinversion_interes', 'reinversion_total')
            AND d.peso_reinv_interes > 0
            THEN d.reinversion_interes_report * d.peso_interes / d.peso_reinv_interes
          ELSE 0
        END AS reinversion_interes_modo
      FROM denominadores d
    ),
    asignacion_residual AS (
      SELECT
        a.*,
        a.reinversion_total_report - SUM(
          a.reinversion_capital_modo + a.reinversion_interes_modo
        ) OVER (PARTITION BY a.liquidacion_id) AS reinversion_residual,
        CASE
          WHEN a.tipo IN ('reinversion_variable', 'reinversion_excedente') THEN a.peso_flujo
          WHEN a.cantidad_modos_variables = 0 AND a.tipo = 'sin_clasificar' THEN a.peso_flujo
          ELSE 0
        END AS peso_residual,
        ROW_NUMBER() OVER (PARTITION BY a.liquidacion_id ORDER BY a.tipo) AS numero_modo
      FROM asignacion_base a
    ),
    asignacion_final AS (
      SELECT
        r.*,
        r.reinversion_capital_modo + r.reinversion_interes_modo
          + CASE
              WHEN SUM(r.peso_residual) OVER (PARTITION BY r.liquidacion_id) > 0
                THEN r.reinversion_residual * r.peso_residual
                  / SUM(r.peso_residual) OVER (PARTITION BY r.liquidacion_id)
              WHEN r.numero_modo = 1 THEN r.reinversion_residual
              ELSE 0
            END AS reinversion_total_modo
      FROM asignacion_residual r
    )
    SELECT
      f.tipo,
      COALESCE(SUM(f.reinversion_capital_modo), 0) AS reinversion_capital,
      COALESCE(SUM(f.reinversion_interes_modo), 0) AS reinversion_interes,
      COALESCE(SUM(f.reinversion_total_modo), 0) AS reinversion_total,
      COALESCE(SUM(f.total_capital_modo), 0) AS total_capital,
      COALESCE(SUM(f.total_interes_modo), 0) AS total_interes,
      COALESCE(SUM(f.total_iva_modo), 0) AS total_iva,
      0 AS iva_facturado,
      COALESCE(SUM(f.total_isr_modo), 0) AS total_isr,
      COALESCE(SUM(f.total_distribuido_modo - f.reinversion_total_modo), 0) AS total_cuota,
      COALESCE(SUM(f.total_distribuido_modo), 0) AS total_distribuido,
      COUNT(DISTINCT f.liquidacion_id)::int AS cantidad,
      (SELECT COUNT(*)::int FROM liquidaciones_mes) AS cantidad_total
    FROM asignacion_final f
    GROUP BY f.tipo
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
      iva_facturado: string;
      total_isr: string;
      total_cuota: string;
      total_distribuido: string;
      cantidad_liquidaciones: number;
      composicion: ReturnType<typeof buildLiquidationComposition>;
    }
  > = {};
  let cantidad = 0;

  const modeRows = canonicalizeLiquidationModeRows(
    (result.rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      tipo: String(row.tipo ?? "sin_clasificar"),
      iva_facturado: String(row.iva_facturado ?? 0),
      cantidad: Number(row.cantidad ?? 0),
      cantidad_total: Number(row.cantidad_total ?? 0),
      reinversion_capital: String(row.reinversion_capital ?? 0),
      reinversion_interes: String(row.reinversion_interes ?? 0),
      reinversion_total: String(row.reinversion_total ?? 0),
      total_capital: String(row.total_capital ?? 0),
      total_interes: String(row.total_interes ?? 0),
      total_iva: String(row.total_iva ?? 0),
      total_isr: String(row.total_isr ?? 0),
      total_distribuido: String(row.total_distribuido ?? 0),
    })),
  );

  for (const r of modeRows) {
    const tipo = String(r.tipo ?? "sin_clasificar");
    const totalCapital = numericMoney(r.total_capital);
    const reinversionNormalizada = normalizeReinvestmentComponents({
      reinvestedCapital: numericMoney(r.reinversion_capital),
      reinvestedRest: numericMoney(r.reinversion_interes),
      reinvestedTotal: numericMoney(r.reinversion_total),
    });
    const reinversionCapital = reinversionNormalizada.capital;
    const reinversionInteres = reinversionNormalizada.rest;
    const reinversionTotal = reinversionNormalizada.total;
    const totalCuota = numericMoney(r.total_cuota);
    porTipo[tipo] = {
      reinversion_capital: reinversionCapital,
      reinversion_interes: reinversionInteres,
      reinversion_total: reinversionTotal,
      total_capital: totalCapital,
      total_interes: numericMoney(r.total_interes),
      total_iva: numericMoney(r.total_iva),
      iva_facturado: numericMoney(r.iva_facturado),
      total_isr: numericMoney(r.total_isr),
      total_cuota: totalCuota,
      total_distribuido: numericMoney(r.total_distribuido),
      cantidad_liquidaciones: Number(r.cantidad ?? 0),
      composicion: buildLiquidationComposition({
        totalCapital,
        paidTotal: totalCuota,
        reinvestedCapital: reinversionCapital,
        reinvestedRest: reinversionInteres,
        reinvestedTotal: reinversionTotal,
      }),
    };
    cantidad = Number(r.cantidad_total ?? 0);
  }

  // No hay una marca fiscal inmutable en las liquidaciones. ISR/IVA no bastan
  // para probar facturación, por lo que el interés se publica sin asignación.
  const facturaRows = await db.execute(sql`
    SELECT
      COALESCE(SUM(l.total_interes::numeric), 0) AS total_interes
    FROM cartera.liquidaciones l
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
  `);

  const interesNoVerificado = numericMoney(
    (facturaRows.rows[0] as Record<string, unknown> | undefined)?.total_interes,
  );

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
  const interesCube = numericMoney(
    (cubeRows.rows[0] as Record<string, unknown> | undefined)?.interes_cube,
  );
  const interesNetoCube = buildCubeNetInterest(interesCube);

  // Pagos extras recibidos (abonos a capital / cancelaciones) de las
  // liquidaciones del mes, leídos directo del abono.
  //
  // Antes se llegaba al abono por `espejo.abono_capital_id`, pero esa es una
  // sola casilla: apunta a UN abono. Mientras hubo una fila por par
  // (crédito, inversionista) daba igual — ese uno era todo. Ahora que cada pago
  // inserta su propia fila, ir por el link se comía las hermanas y subcontaba.
  // `abonos_capital.liquidacion_id` se setea al cerrar el abono, así que no hace
  // falta el rodeo ni el DISTINCT.
  const extrasRows = await db.execute(sql`
    SELECT a.tipo, COALESCE(SUM(a.monto::numeric), 0) AS total
    FROM cartera.abonos_capital a
    JOIN cartera.liquidaciones l ON l.liquidacion_id = a.liquidacion_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    GROUP BY a.tipo
  `);

  let abonosCapital = new Big(0);
  let cancelaciones = new Big(0);
  for (const r of extrasRows.rows as Record<string, unknown>[]) {
    if (r.tipo === "CAPITAL") abonosCapital = new Big(String(r.total ?? 0));
    if (r.tipo === "CANCELACION") cancelaciones = new Big(String(r.total ?? 0));
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
  cancelaciones = cancelaciones.plus(
    String((cancelExtraRows.rows[0] as Record<string, unknown> | undefined)?.total ?? 0),
  );

  // Desglose por inversionista (desde las liquidaciones del mes):
  //   - reinversion_capital / reinversion_interes / reinversion (total)
  //   - a_recibir = SUM(total_cuota)
  //   - monto_aportado = lo que le quedó al inversionista tras la liquidación
  const porInvRows = await db.execute(sql`
    SELECT
      l.inversionista_id,
      i.nombre,
      COALESCE(l.tipo_reinversion_snapshot::text, 'sin_clasificar') AS tipo_reinversion,
      l.reinversion_capital,
      l.reinversion_interes,
      l.reinversion_total AS reinversion,
      l.total_cuota AS a_recibir,
      l.total_capital
    FROM cartera.liquidaciones l
    JOIN cartera.inversionistas i ON l.inversionista_id = i.inversionista_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    ORDER BY i.nombre, l.liquidacion_id
  `);

  const investorTotals = aggregateInvestorLiquidationRows(
    (porInvRows.rows as Record<string, unknown>[]).map((row) => ({
      inversionistaId: Number(row.inversionista_id),
      nombre: String(row.nombre),
      tipoReinversion: String(row.tipo_reinversion ?? "sin_clasificar"),
      reinvestedCapital: String(row.reinversion_capital ?? 0),
      reinvestedRest: String(row.reinversion_interes ?? 0),
      reinvestedTotal: String(row.reinversion ?? 0),
      paidTotal: String(row.a_recibir ?? 0),
      totalCapital: String(row.total_capital ?? 0),
    })),
  );

  // Capital operativo actual desde el espejo canónico. La reinversión ya está
  // reflejada aquí, por lo que no se suma nuevamente desde la liquidación. Las
  // compras aún no aceptadas ya incrementaron el espejo y se restan por posición.
  const capitalActivoRows = await db.execute(sql`
    WITH pending_purchase_deltas AS (
      SELECT
        c.credito_id,
        c.inversionista_id,
        SUM(c.monto_aportado::numeric) AS monto_pendiente
      FROM cartera.compras_credito_inversionista c
      WHERE c.tipo_operacion = 'compra_cartera'
        AND c.status = 'pendiente_compra_cartera'
      GROUP BY c.credito_id, c.inversionista_id
    )
    SELECT
      ce.inversionista_id,
      COALESCE(SUM(ce.monto_aportado::numeric), 0) AS monto_espejo,
      COALESCE(SUM(ppd.monto_pendiente), 0) AS monto_compra_pendiente
    FROM cartera.creditos_inversionistas_espejo ce
    JOIN cartera.creditos cr ON cr.credito_id = ce.credito_id
    LEFT JOIN pending_purchase_deltas ppd
      ON ppd.credito_id = ce.credito_id
     AND ppd.inversionista_id = ce.inversionista_id
    WHERE ce.inversionista_id IN (
      SELECT DISTINCT l.inversionista_id
      FROM cartera.liquidaciones l
      WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
        AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    )
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
    GROUP BY ce.inversionista_id
  `);
  const capitalActivoPorInv = new Map<number, string>();
  for (const r of capitalActivoRows.rows as Record<string, unknown>[]) {
    capitalActivoPorInv.set(
      Number(r.inversionista_id),
      calculateActiveCapital(
        String(r.monto_espejo ?? 0),
        String(r.monto_compra_pendiente ?? 0),
      )
    );
  }

  const porInversionista = investorTotals.map(
    (r) => {
      const id = Number(r.inversionista_id);
      const reinversionCapital = r.reinversion_capital;
      const reinversionInteres = r.reinversion_interes;
      const reinversion = r.reinversion;
      const aRecibir = numericMoney(r.a_recibir);
      return {
        inversionista_id: id,
        nombre: String(r.nombre),
        tipo_reinversion: String(r.tipo_reinversion ?? "sin_clasificar"),
        reinversion_capital: reinversionCapital,
        reinversion_interes: reinversionInteres,
        reinversion,
        a_recibir: aRecibir,
        capital_activo: capitalActivoPorInv.get(id) ?? "0.00",
        composicion: buildLiquidationComposition({
          totalCapital: numericMoney(r.total_capital),
          paidTotal: aRecibir,
          reinvestedCapital: reinversionCapital,
          reinvestedRest: reinversionInteres,
          reinvestedTotal: reinversion,
        }),
      };
    }
  ).filter(shouldIncludeInvestorPosition);

  // Compras del mes: solo operación de compra (no reinversión) y solo las
  // COMPLETADAS (status = 'completado'); las pendientes no se cuentan. La fecha
  // efectiva prioriza fecha_completada y cae a updated_at cuando es NULL
  // (columna nueva, registros viejos) — mismo criterio que utils/comprasAjuste.ts.
  const fechaCompra = sql`COALESCE(c.fecha_completada, c.updated_at)`;
  const comprasMesPredicate = sql`
    c.tipo_operacion = 'compra_cartera'
    AND c.status = 'completado'
    AND (${fechaCompra} AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
    AND (${fechaCompra} AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
  `;
  const comprasRows = await db.execute(sql`
    SELECT
      COALESCE(c.modalidad_facturacion::text, 'sin_modalidad') AS modalidad_facturacion,
      COALESCE(c.tipo_reinversion::text, 'sin_reinversion') AS tipo_reinversion,
      c.tipo_compra::text AS tipo_compra,
      c.monto_aportado AS monto
    FROM cartera.compras_credito_inversionista c
    WHERE ${comprasMesPredicate}
    ORDER BY ${fechaCompra}, c.id
  `);
  const comprasMes = summarizePurchaseDetails(
    (comprasRows.rows as Record<string, unknown>[]).map((r) => ({
      modalidad_facturacion: String(r.modalidad_facturacion ?? "sin_modalidad"),
      tipo_reinversion: String(r.tipo_reinversion ?? "sin_reinversion"),
      tipo_compra: String(r.tipo_compra ?? "sin_clasificar") as
        | "nueva_posicion"
        | "ampliacion_posicion"
        | "sin_clasificar",
      monto: String(r.monto ?? 0),
    })),
  );
  const ticketRows = await db.execute(sql`
    SELECT
      TO_CHAR(
        DATE_TRUNC('month', ${fechaCompra} AT TIME ZONE 'America/Guatemala'),
        'YYYY-MM'
      ) AS periodo,
      c.tipo_compra::text AS tipo_compra,
      COUNT(*)::int AS cantidad,
      COALESCE(SUM(c.monto_aportado::numeric), 0) AS monto
    FROM cartera.compras_credito_inversionista c
    WHERE c.tipo_operacion = 'compra_cartera'
      AND c.status = 'completado'
    GROUP BY periodo, c.tipo_compra
    ORDER BY periodo
  `);
  const ticketInversion = buildPurchaseTicketHistory(
    (ticketRows.rows as Record<string, unknown>[]).map((r) => ({
      periodo: String(r.periodo),
      tipo_compra: String(r.tipo_compra ?? "sin_clasificar") as
        | "nueva_posicion"
        | "ampliacion_posicion"
        | "sin_clasificar",
      cantidad: Number(r.cantidad ?? 0),
      monto: String(r.monto ?? 0),
    })),
    `${anio}-${String(mes).padStart(2, "0")}`,
  );

  let detalleInteresNeto: Array<
    | ReturnType<typeof buildNetInterestDetail>
    | {
        inversionista_id: number;
        inversionista: string;
        referencia: string;
        tratamiento_fiscal: "cube";
        interes: string;
        iva: string;
        isr: string;
        neto: string;
      }
  > = [];
  let detallePagosExtras: {
    fecha: string;
    credito: string;
    tipo: "abono_capital" | "cancelacion";
    monto: string;
  }[] = [];
  let detalleComprasMes: {
    fecha: string;
    inversionista: string;
    modalidad_facturacion: string;
    tipo_reinversion: string;
    tipo_compra: "nueva_posicion" | "ampliacion_posicion" | "sin_clasificar";
    monto: string;
  }[] = [];
  let detalleEstado: { disponible: boolean; error: string | null } = {
    disponible: true,
    error: null,
  };

  try {
    const interesDetalleRows = await db.execute(sql`
    SELECT
      l.inversionista_id,
      i.nombre AS inversionista,
      'LIQ-' || l.liquidacion_id::text AS referencia,
      l.total_interes AS interes,
      l.total_iva AS iva,
      l.total_isr AS isr
    FROM cartera.liquidaciones l
    JOIN cartera.inversionistas i ON i.inversionista_id = l.inversionista_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    ORDER BY i.nombre, l.liquidacion_id
  `);
    detalleInteresNeto = (
      interesDetalleRows.rows as Record<string, unknown>[]
    ).map((r) =>
      buildNetInterestDetail({
        inversionista_id: Number(r.inversionista_id),
        inversionista: String(r.inversionista),
        referencia: String(r.referencia),
        interes: String(r.interes ?? 0),
        iva: String(r.iva ?? 0),
        isr: String(r.isr ?? 0),
      })
    );
    if (!new Big(interesCube).eq(0)) {
      detalleInteresNeto.push({
        inversionista_id: 86,
        inversionista: "CUBE",
        referencia: "Participación CUBE",
        tratamiento_fiscal: "cube",
        interes: interesNetoCube.interes,
        iva: interesNetoCube.iva,
        isr: "0.00",
        neto: interesNetoCube.neto,
      });
    }

    const extrasDetalleRows = await db.execute(sql`
    SELECT
      (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date::text AS fecha,
      cr.numero_credito_sifco AS credito,
      CASE WHEN a.tipo = 'CAPITAL' THEN 'abono_capital' ELSE 'cancelacion' END AS tipo,
      a.monto
    FROM cartera.abonos_capital a
    JOIN cartera.liquidaciones l ON l.liquidacion_id = a.liquidacion_id
    JOIN cartera.creditos cr ON cr.credito_id = a.credito_id
    WHERE (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date >= ${inicioMes}::date
      AND (l.fecha_liquidacion AT TIME ZONE 'America/Guatemala')::date < ${inicioMesSiguiente}::date
    ORDER BY l.fecha_liquidacion, cr.numero_credito_sifco
  `);
    detallePagosExtras = (
      extrasDetalleRows.rows as Record<string, unknown>[]
    ).map((r) => ({
      fecha: String(r.fecha),
      credito: String(r.credito),
      tipo: String(r.tipo) as "abono_capital" | "cancelacion",
      monto: String(r.monto ?? 0),
    }));
    const manualDetalleRows = await db.execute(sql`
    SELECT
      (MAX(l.fecha_liquidacion) AT TIME ZONE 'America/Guatemala')::date::text AS fecha,
      cr.numero_credito_sifco AS credito,
      SUM(pe.abono_capital::numeric) AS monto,
      COALESCE(MAX(ce.monto_aportado::numeric), 0) AS monto_aportado,
      bool_and(ce.id IS NULL) AS sin_fila
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
    GROUP BY pe.credito_id, pe.inversionista_id, cr.numero_credito_sifco
    HAVING COALESCE(MAX(ce.monto_aportado::numeric), 0) = 0 OR bool_and(ce.id IS NULL)
    ORDER BY fecha, cr.numero_credito_sifco
  `);
    detallePagosExtras.push(
      ...(manualDetalleRows.rows as Record<string, unknown>[]).map((r) => ({
        fecha: String(r.fecha),
        credito: String(r.credito),
        tipo: "cancelacion" as const,
        monto: String(r.monto ?? 0),
      }))
    );
    for (const tipo of ["abono_capital", "cancelacion"] as const) {
      const rows = detallePagosExtras.filter((row) => row.tipo === tipo);
      const amounts = allocateRoundedAmounts(rows.map((row) => row.monto));
      rows.forEach((row, index) => {
        row.monto = amounts[index];
      });
    }

    const comprasDetalleRows = await db.execute(sql`
    SELECT
      (${fechaCompra} AT TIME ZONE 'America/Guatemala')::date::text AS fecha,
      i.nombre AS inversionista,
      COALESCE(c.modalidad_facturacion::text, 'sin_modalidad') AS modalidad_facturacion,
      COALESCE(c.tipo_reinversion::text, 'sin_reinversion') AS tipo_reinversion,
      c.tipo_compra::text AS tipo_compra,
      c.monto_aportado AS monto
    FROM cartera.compras_credito_inversionista c
    JOIN cartera.inversionistas i ON i.inversionista_id = c.inversionista_id
    WHERE ${comprasMesPredicate}
    ORDER BY ${fechaCompra}, i.nombre
  `);
    detalleComprasMes = allocateRoundedPurchaseAmounts(
      (comprasDetalleRows.rows as Record<string, unknown>[]).map((r) => {
        const modalidadFacturacion = String(
          r.modalidad_facturacion ?? "sin_modalidad",
        );
        const tipoReinversion = String(r.tipo_reinversion ?? "sin_reinversion");
        const tipoCompra = String(r.tipo_compra ?? "sin_clasificar") as
          | "nueva_posicion"
          | "ampliacion_posicion"
          | "sin_clasificar";
        return {
        fecha: String(r.fecha),
        inversionista: String(r.inversionista),
        modalidad_facturacion: modalidadFacturacion,
        tipo_reinversion: tipoReinversion,
        tipo_compra: tipoCompra,
        modalidad: `${modalidadFacturacion}\u0000${tipoReinversion}\u0000${tipoCompra}`,
        monto: String(r.monto ?? 0),
        };
      }),
    ).map(({ modalidad: _modalidad, ...row }) => row);
  } catch (error) {
    console.error(
      "No fue posible recuperar el detalle del reporte de reinversión",
      error,
    );
    detalleInteresNeto = [];
    detallePagosExtras = [];
    detalleComprasMes = [];
    detalleEstado = {
      disponible: false,
      error: getPublicReinvestmentDetailError(error),
    };
  }

  const interesNeto = {
    noVerificado: {
      interes: interesNoVerificado,
    },
    cube: interesNetoCube,
  };
  const pagosExtras = {
    abonos_capital: abonosCapital.toFixed(2),
    cancelaciones: cancelaciones.toFixed(2),
  };

  if (detalleEstado.disponible) {
    assertReportReconciliation({
      interesNeto,
      pagosExtras,
      comprasMes,
      detalleInteresNeto,
      detallePagosExtras,
      detalleComprasMes,
    });
  }
  for (const modalidad of Object.values(porTipo)) {
    assertModeReconciliation(modalidad);
  }

  return {
    contrato_version: 3 as const,
    porTipo,
    porInversionista,
    comprasMes,
    ticketInversion,
    detalleInteresNeto,
    detallePagosExtras,
    detalleComprasMes,
    detalle_estado: detalleEstado,
    interesNeto,
    pagosExtras,
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

type CapitalCarteraRow = {
  asesor_id: number;
  nombre: string;
  email_asesor: string | null;
  capital: string;
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

// Fragmento CASE compartido: clasifica cuotas atrasadas en el bucket de mora.
// Umbral global (NO tocar sin revisar ambos call sites): >=4 → mora_120_plus,
// =3 → mora_90, =2 → mora_60, resto → mora_30. Recibe la expresión de columna
// (m.cuotas_atrasadas en el live path, s.cuotas en el histórico) para que
// ambas queries compartan una única definición.
export const bucketCaseSql = (col: ReturnType<typeof sql>) => sql`CASE
  WHEN ${col} >= 4 THEN 'mora_120_plus'
  WHEN ${col} = 3  THEN 'mora_90'
  WHEN ${col} = 2  THEN 'mora_60'
  ELSE                  'mora_30'
END`;

function serializeCapitalCartera(rows: CapitalCarteraRow[]) {
  const porAsesor = rows.map((row) => ({
    asesorId: row.asesor_id,
    nombre: row.nombre,
    email: row.email_asesor ?? "",
    capital: Number(row.capital).toFixed(2),
  }));
  const total = porAsesor.reduce(
    (sum, asesor) => sum + Number(asesor.capital),
    0,
  );
  return { total: total.toFixed(2), porAsesor };
}

type MoraByEtapaYAsesorResult = ReturnType<typeof acumularBuckets> & {
  capitalCartera: ReturnType<typeof serializeCapitalCartera>;
  metadata: {
    capitalCartera: "actual";
    atribucionAsesor: "actual";
  };
  fecha: string;
  alcance: "live" | "historico";
  dataDisponibleDesde?: string;
};

export async function getMoraByEtapaYAsesor({
  emailCobrador,
  fecha,
  asesores,
}: { emailCobrador?: string; fecha?: string; asesores?: number[] } = {}): Promise<MoraByEtapaYAsesorResult> {
  const hoy = hoyGTStr();
  const usarHistorico = !!fecha && fecha < hoy;

  const emailFilter = emailCobrador
    ? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
    : sql``;
  const asesoresFilter = asesores && asesores.length
    ? sql`AND a.asesor_id IN (${sql.join(asesores.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  return db.transaction(
    async (tx) => {
      if (!usarHistorico) {
        const rows = await tx.execute<MoraRow>(sql`
      WITH mora_activa AS (
        SELECT DISTINCT ON (credito_id)
          credito_id, cuotas_atrasadas, monto_mora
        FROM cartera.moras_credito
        WHERE activa = true AND cuotas_atrasadas > 0
        ORDER BY credito_id, mora_id DESC
      )
      SELECT
        a.asesor_id, a.nombre, a.email_cash_in AS email_asesor,
        ${bucketCaseSql(sql`m.cuotas_atrasadas`)} AS bucket,
        COUNT(*)::int AS cantidad,
        COALESCE(SUM(c.capital::numeric), 0) AS suma_capital,
        COALESCE(SUM(m.monto_mora::numeric), 0) AS suma_mora
      FROM mora_activa m
      INNER JOIN cartera.creditos c ON c.credito_id = m.credito_id
      INNER JOIN cartera.asesores a ON a.asesor_id  = c.asesor_id
      WHERE c."statusCredit" IN (${creditosElegiblesMoraSql})
        ${emailFilter}
        ${asesoresFilter}
      GROUP BY a.asesor_id, a.nombre, a.email_cash_in, bucket
    `);
        const capitalRows = await tx.execute<CapitalCarteraRow>(
          buildCapitalCarteraQuery(emailCobrador, asesores),
        );
        return {
          ...acumularBuckets(rows.rows),
          capitalCartera: serializeCapitalCartera(capitalRows.rows),
          metadata: {
            capitalCartera: "actual" as const,
            atribucionAsesor: "actual" as const,
          },
          fecha: hoy,
          alcance: "live" as const,
        };
      }

      const rows = await tx.execute<MoraRow>(sql`
    WITH ${snapCte(fecha!)}
    SELECT
      a.asesor_id, a.nombre, a.email_cash_in AS email_asesor,
      ${bucketCaseSql(sql`s.cuotas`)} AS bucket,
      COUNT(*)::int AS cantidad,
      COALESCE(SUM(c.capital::numeric), 0) AS suma_capital,
      COALESCE(SUM(s.monto), 0) AS suma_mora
    FROM snap s
    INNER JOIN cartera.creditos c ON c.credito_id = s.credito_id
    INNER JOIN cartera.asesores a ON a.asesor_id  = c.asesor_id
    WHERE s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0 AND s.cuotas > 0
      AND c."statusCredit" IN (${creditosElegiblesMoraSql})
      ${emailFilter}
      ${asesoresFilter}
    GROUP BY a.asesor_id, a.nombre, a.email_cash_in, bucket
  `);
      const capitalRows = await tx.execute<CapitalCarteraRow>(
        buildCapitalCarteraQuery(emailCobrador, asesores),
      );
      const result = acumularBuckets(rows.rows);
      const capitalCartera = serializeCapitalCartera(capitalRows.rows);
      const metadata = {
        capitalCartera: "actual" as const,
        atribucionAsesor: "actual" as const,
      };
      if (!result.porAsesor.length) {
        const minRes = await tx.execute<{ min_fecha: string | null }>(sql`
      SELECT MIN((fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date)::text AS min_fecha
      FROM cartera.moras_historial
    `);
        const minFecha = minRes.rows[0]?.min_fecha ?? null;
        if (minFecha && fecha! < minFecha) {
          return {
            ...result,
            capitalCartera,
            metadata,
            fecha,
            alcance: "historico" as const,
            dataDisponibleDesde: minFecha,
          };
        }
      }
      return {
        ...result,
        capitalCartera,
        metadata,
        fecha,
        alcance: "historico" as const,
      };
    },
    {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    },
  );
}

// Mora COBRADA por asesor en el período de cierre de un mes.
// Período = [día 6 del mes, día 6 del mes siguiente) — alineado a que el cierre
// corre el día 5. Suma cartera.pagos_credito.mora (lo efectivamente aplicado a
// mora en cada pago), excluyendo pagos marcados como falsos.
export async function getMoraCobradaPorAsesor({
  mes,
  anio,
  asesores,
  emailCobrador,
}: {
  mes: number;
  anio: number;
  asesores?: number[];
  emailCobrador?: string;
}) {
  const mm = String(mes).padStart(2, "0");
  const inicio = `${anio}-${mm}-06`;
  const finMes = mes === 12 ? 1 : mes + 1;
  const finAnio = mes === 12 ? anio + 1 : anio;
  const fin = `${finAnio}-${String(finMes).padStart(2, "0")}-06`;

  const emailFilter = emailCobrador
    ? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
    : sql``;
  const asesoresFilter = asesores && asesores.length
    ? sql`AND a.asesor_id IN (${sql.join(asesores.map((id) => sql`${id}`), sql`, `)})`
    : sql``;

  const rows = await db.execute<{ asesor_id: number; nombre: string; cobrado: string }>(sql`
    SELECT
      a.asesor_id,
      a.nombre,
      COALESCE(SUM(pc.mora::numeric), 0) AS cobrado
    FROM cartera.pagos_credito pc
    INNER JOIN cartera.creditos c ON c.credito_id = pc.credito_id
    INNER JOIN cartera.asesores a ON a.asesor_id  = c.asesor_id
    WHERE pc.fecha_pago >= ${inicio}::timestamp
      AND pc.fecha_pago <  ${fin}::timestamp
      AND COALESCE(pc."paymentFalse", false) = false
      ${emailFilter}
      ${asesoresFilter}
    GROUP BY a.asesor_id, a.nombre
  `);

  const porAsesor = rows.rows
    .map((r) => ({ asesorId: r.asesor_id, nombre: r.nombre, cobrado: Number(r.cobrado).toFixed(2) }))
    .filter((r) => Number(r.cobrado) !== 0)
    .sort((x, y) => Number(y.cobrado) - Number(x.cobrado));
  const totalCobrado = porAsesor.reduce((s, r) => s + Number(r.cobrado), 0).toFixed(2);

  return { periodo: { inicio, fin }, porAsesor, totalCobrado };
}

export async function getMoraRecuperacionPorAsesor({
  mes,
  anio,
  asesores,
  emailCobrador,
}: {
  mes: number;
  anio: number;
  asesores?: number[];
  emailCobrador?: string;
}) {
  const period = getMoraRecoveryPeriod({ mes, anio, hoy: hoyGTStr() });

  const result = await db.execute<{
    asesor_id: number | null;
    nombre: string | null;
    esperado: string;
    cobrado_en_snapshot: string;
    cobrado_fuera_snapshot: string;
  }>(buildMoraRecoveryQuery({ ...period, asesores, emailCobrador }));

  return buildMoraRecoveryReport(
    result.rows.map((row): MoraRecoverySourceRow => ({
      asesorId: row.asesor_id,
      nombre: row.nombre ?? "Sin asignar",
      esperado: row.esperado,
      cobradoEnSnapshot: row.cobrado_en_snapshot,
      cobradoFueraSnapshot: row.cobrado_fuera_snapshot,
    })),
    period,
  );
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
