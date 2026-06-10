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
