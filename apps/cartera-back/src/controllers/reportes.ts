import { sql } from "drizzle-orm";
import { db } from "../database";

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

  const result = await db.execute(sql`
    WITH
    pagos_en_rango AS (
      SELECT
        pc.credito_id,
        pc.cuota_id,
        q.fecha_vencimiento                                                                            AS fecha_venc,
        MIN(COALESCE(pc.capital_restante::numeric, 0))  + SUM(COALESCE(pc.abono_capital::numeric, 0))   AS capital_restante,
        MIN(COALESCE(pc.interes_restante::numeric, 0))  + SUM(COALESCE(pc.abono_interes::numeric, 0))   AS interes_restante,
        MIN(COALESCE(pc.iva_12_restante::numeric, 0))   + SUM(COALESCE(pc.abono_iva_12::numeric, 0))    AS iva_12_restante,
        MIN(COALESCE(pc.seguro_restante::numeric, 0))   + SUM(COALESCE(pc.abono_seguro::numeric, 0))    AS seguro_restante,
        MIN(COALESCE(pc.gps_restante::numeric, 0))      + SUM(COALESCE(pc.abono_gps::numeric, 0))       AS gps_restante,
        MIN(COALESCE(pc.membresias::numeric, 0))        + SUM(COALESCE(pc.membresias_pago::numeric, 0)) AS membresias,
        SUM(COALESCE(pc.monto_boleta::numeric, 0))                                                       AS monto_boleta
      FROM cartera.pagos_credito pc
      JOIN cartera.cuotas_credito q ON q.cuota_id = pc.cuota_id
      WHERE pc."paymentFalse" = false
        AND q.fecha_vencimiento::date >= ${fechaInicio}::date
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
             THEN COALESCE(MAX(m.monto_mora::numeric), 0)
             ELSE 0 END                                                 AS mora_val
      FROM pagos_en_rango p
      INNER JOIN cartera.creditos c ON p.credito_id = c.credito_id
      INNER JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
      INNER JOIN cartera.asesores a ON c.asesor_id = a.asesor_id
      LEFT JOIN cartera.moras_credito m ON m.credito_id = c.credito_id AND m.activa = true
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
          ) < p.fecha_venc::date
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
          AND qc_mora.pagado = false
          AND NOT EXISTS (
            SELECT 1 FROM cartera.pagos_credito pc_mora
            WHERE pc_mora.cuota_id = qc_mora.cuota_id
              AND pc_mora."paymentFalse" = false
              AND pc_mora.pagado = true
              AND pc_mora.validation_status IN ('validated', 'no_required')
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
            AND q_a.pagado = false
            AND NOT EXISTS (
              SELECT 1 FROM cartera.pagos_credito pc2
              WHERE pc2.cuota_id = q_a.cuota_id
                AND pc2."paymentFalse" = false
                AND pc2.pagado = true
                AND pc2.validation_status IN ('validated', 'no_required')
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
    )
    SELECT
      bucket,
      COALESCE(SUM(cuotas_count), 0)::int                                                        AS cuotas_count,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN exp_capital ELSE 0 END), 0)               AS total_cuota,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN interes     ELSE 0 END), 0)               AS total_interes,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN iva         ELSE 0 END), 0)               AS total_iva,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN seguro      ELSE 0 END), 0)               AS total_seguro,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN gps         ELSE 0 END), 0)               AS total_gps,
      COALESCE(SUM(CASE WHEN NOT excluido_factura THEN mem         ELSE 0 END), 0)               AS total_membresias,
      AVG(CASE WHEN cuotas_atrasadas > 0 AND NOT excluido_mora THEN mora_val END)                AS mora_promedio,
      COUNT(*) FILTER (WHERE cuotas_atrasadas > 0 AND NOT excluido_mora)::int                   AS mora_count,
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
        ELSE mem END), 0)                                                                         AS acum_total_membresias
    FROM per_bucket_credit
    GROUP BY bucket
    ORDER BY bucket ASC
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

  return {
    porTipo,
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
