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
