import { db } from "../database";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Premora (CC2-11) — cuotas próximas a vencer de créditos AL DÍA.
// Solo lectura: el CRM lo consume con su job diario de recordatorios D-5/D-3/
// D-1/D-0 (el WhatsApp vive allá; cartera-back solo responde datos).
//
// "Al día" = ACTIVO y SIN ninguna cuota vencida pendiente (B0, cartera sana —
// alcance confirmado: los morosos ya los gestiona su asesor por bucket).
// "Pendiente" = mismo predicado que el motor de moras: cuota sin pagar y sin
// pago validado que haya aplicado plata REAL (monto_aplicado > 0) — así las
// etiquetas de pagado no dejan pasar recordatorios a quien ya pagó.
// ─────────────────────────────────────────────────────────────────────────────

// Fila de pago que realmente cubre una cuota (predicado espejo de
// procesarMoras/createMora en latefee.ts — mantener alineados).
const pagoCubriente = (cuotaIdCol: ReturnType<typeof sql.raw>) => sql`
  SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
  WHERE pc.cuota_id = ${cuotaIdCol}
    AND pc."paymentFalse" = false
    AND pc.pagado = true
    AND pc.validation_status IN ('validated', 'no_required')
    AND COALESCE(pc.monto_aplicado, 0) > 0`;

export async function getCuotasProximasVencer(
  dias: number[],
  opts: { soloAlDia?: boolean; buckets?: number[] } = {},
) {
  // Default true: premora SOLO recuerda a créditos al día (B0). Con false
  // (la Agenda del día del CRM) entra TODO el funnel — el asesor gestiona
  // también las cuotas próximas de créditos en mora.
  const soloAlDia = opts.soloAlDia !== false;
  // buckets: filtro por bucket MOTOR (PREMORA_BUCKETS del CRM). Un crédito
  // SIN historial de buckets NO se asume B0 a ciegas (review Codex): solo
  // cuenta como B0 si además está al día EN TIEMPO REAL — si no, un moroso
  // sin INICIAL recibiría la plantilla amistosa de cartera sana. Orthogonal
  // a soloAlDia: el job del CRM manda soloAlDia=false + buckets=0,1,...
  // cuando el funnel de recordatorios está encendido.
  const buckets = opts.buckets ?? [];
  const hoyGT = sql`(now() AT TIME ZONE 'America/Guatemala')::date`;
  const diasList = sql.join(
    dias.map((d) => sql`${d}`),
    sql`, `,
  );

  const filtroEstado = soloAlDia
    ? sql`c."statusCredit" = 'ACTIVO'`
    : sql`c."statusCredit" IN ('ACTIVO', 'MOROSO', 'INCOBRABLE')`;

  const bucketMotorSub = sql`(SELECT h.bucket_nuevo
      FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = c.credito_id
      ORDER BY h.fecha DESC, h.historial_id DESC
      LIMIT 1)`;

  // Crédito al día EN TIEMPO REAL (mismo criterio estricto del modo premora).
  const esAlDiaReal = sql`(c."statusCredit" = 'ACTIVO'
      AND NOT EXISTS (
        SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
        WHERE v.credito_id = c.credito_id
          AND v.fecha_vencimiento::date < ${hoyGT}
          AND v.pagado = false
          AND NOT EXISTS (${pagoCubriente(sql.raw("v.cuota_id"))})
      ))`;

  const bucketsList = sql.join(
    buckets.map((b) => sql`${b}`),
    sql`, `,
  );
  const filtroBuckets =
    buckets.length > 0
      ? sql`AND (
      ${bucketMotorSub} IN (${bucketsList})
      ${
        buckets.includes(0)
          ? sql`OR (${bucketMotorSub} IS NULL AND ${esAlDiaReal})`
          : sql``
      }
    )`
      : sql``;

  const res = await db.execute<any>(sql`
    SELECT
      cu.cuota_id,
      cu.credito_id,
      cu.numero_cuota,
      cu.fecha_vencimiento::date::text AS fecha_vencimiento,
      (cu.fecha_vencimiento::date - ${hoyGT})::int AS dias_para_vencer,
      c.numero_credito_sifco,
      c."statusCredit" AS status_credit,
      -- Bucket MOTOR (último de buckets_historial, misma fuente que el listado
      -- por bucket): NULL si el crédito no tiene INICIAL registrado.
      (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
        WHERE h.credito_id = c.credito_id
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1) AS bucket,
      ROUND(c.cuota::numeric, 2)::text AS monto_cuota,
      u.nombre AS cliente,
      -- usuarios NO tiene teléfono en cartera (solo asesores/admins/conta/
      -- inversionistas lo tienen). Se devuelve NULL para mantener la forma
      -- del API: el CRM resuelve el teléfono real con caso de cobros → lead.
      NULL::text AS telefono_cliente_cartera,
      c.asesor_id,
      a.nombre AS asesor,
      a.telefono AS telefono_asesor
    FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = cu.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    WHERE ${filtroEstado}
      ${filtroBuckets}
      AND cu.pagado = false
      AND NOT EXISTS (${pagoCubriente(sql.raw("cu.cuota_id"))})
      -- Ya hay un pago REGISTRADO para esta cuota aunque CONTA no lo haya
      -- validado todavía: no recordarle a quien ya mandó su boleta.
      AND NOT EXISTS (
        SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pr
        WHERE pr.cuota_id = cu.cuota_id
          AND pr."paymentFalse" = false
          AND pr.validation_status = 'pending'
          AND COALESCE(pr.monto_boleta, 0) > 0
      )
      AND (cu.fecha_vencimiento::date - ${hoyGT}) IN (${diasList})
      -- Crédito AL DÍA: ninguna cuota ya vencida sigue pendiente (solo premora).
      ${
        soloAlDia
          ? sql`AND NOT EXISTS (
        SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
        WHERE v.credito_id = cu.credito_id
          AND v.fecha_vencimiento::date < ${hoyGT}
          AND v.pagado = false
          AND NOT EXISTS (${pagoCubriente(sql.raw("v.cuota_id"))})
      )`
          : sql``
      }
    ORDER BY dias_para_vencer ASC, c.numero_credito_sifco ASC
  `);

  return { success: true, total: res.rows.length, data: res.rows };
}
