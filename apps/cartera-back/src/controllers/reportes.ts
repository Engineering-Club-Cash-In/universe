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
    SELECT
      DATE_TRUNC(${pg}, c.fecha_vencimiento::timestamp) AS bucket,
      COUNT(c.cuota_id)::int AS cuotas_count,
      COALESCE(SUM(cr.cuota::numeric), 0) AS total_cuota,
      COALESCE(SUM(cr.cuota_interes::numeric), 0) AS total_interes,
      COALESCE(SUM(cr.iva_12::numeric), 0) AS total_iva,
      COALESCE(SUM(cr.seguro_10_cuotas::numeric / NULLIF(cr.plazo::numeric, 0)), 0) AS total_seguro,
      COALESCE(SUM(cr.gps::numeric / NULLIF(cr.plazo::numeric, 0)), 0) AS total_gps,
      COALESCE(SUM(cr.membresias_pago::numeric), 0) AS total_membresias,
      COALESCE(SUM(cr.royalti::numeric / NULLIF(cr.plazo::numeric, 0)), 0) AS total_royalti,
      COALESCE(AVG(m.monto_mora::numeric), 0) AS mora_promedio
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    LEFT JOIN cartera.moras_credito m ON m.credito_id = cr.credito_id AND m.activa = true
    WHERE c.pagado = false
      AND cr."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
      AND c.fecha_vencimiento >= ${fechaInicio}::date
      AND c.fecha_vencimiento <= ${fechaFin}::date
    GROUP BY DATE_TRUNC(${pg}, c.fecha_vencimiento::timestamp)
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
    WHERE DATE_PART('month', (p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date) = ${mes}
      AND DATE_PART('year', (p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date) = ${anio}
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
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(cr.cuota::numeric), 0) AS esperado_capital,
      COALESCE(SUM(cr.cuota_interes::numeric), 0) AS esperado_interes,
      COALESCE(SUM(cr.iva_12::numeric), 0) AS esperado_iva,
      COALESCE(SUM(cr.seguro_10_cuotas::numeric), 0) AS esperado_seguro,
      COALESCE(SUM(cr.gps::numeric), 0) AS esperado_gps,
      COALESCE(SUM(cr.membresias_pago::numeric), 0) AS esperado_membresias
    FROM cartera.cuotas_credito c
    JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
    WHERE DATE_PART('month', c.fecha_vencimiento::date) = ${mes}
      AND DATE_PART('year', c.fecha_vencimiento::date) = ${anio}
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
