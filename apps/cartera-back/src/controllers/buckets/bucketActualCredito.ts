import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import {
  bucketActualSql,
  STATUS_BUCKET_FUERA,
} from "../../lib/buckets-classification";

export type BucketActualCredito = {
  credito_id: number;
  numero_credito_sifco: string;
  bucket: number | null;
  prefijo: string | null;
  nombre: string | null;
  color: string | null;
  estado_mora: string | null;
  /** true = statusCredit en STATUS_BUCKET_FUERA (EN_CONVENIO, CANCELADO...): sin bucket POR DISEÑO. */
  fuera_funnel: boolean;
  /**
   * CB-026: fecha en que el crédito ENTRÓ al bucket actual (ISO), tomada de la
   * última fila de buckets_historial. null cuando el bucket NO vino de esa fila
   * sino de un branch de fallback de bucketActualSql (estado que fuerza bucket
   * o rango de cuotas, típico de ambientes sin backfill de COBROS-02) — en ese
   * caso no existe fecha de entrada confiable y no se inventa una.
   */
  fecha_entrada_bucket: string | null;
};

/**
 * Bucket ACTUAL de un crédito por número SIFCO + su fila del catálogo.
 * Misma fuente que el listado /buckets/creditos y la reasignación manual
 * (bucketActualSql): COALESCE(último buckets_historial → estado que fuerza
 * bucket → rango de cuotas de la mora activa). `bucket = null` con
 * `fuera_funnel = true` es una respuesta CORRECTA (el crédito salió del
 * funnel), no un error.
 */
export async function getBucketActualPorSifco(
  numero_credito_sifco: string,
): Promise<BucketActualCredito | null> {
  const fueraSql = sql.join(
    STATUS_BUCKET_FUERA.map((s) => sql`${s}`),
    sql`, `,
  );
  const res = await db.execute<{
    credito_id: number;
    numero_credito_sifco: string;
    fuera: boolean;
    bucket: number | null;
    prefijo: string | null;
    nombre: string | null;
    color: string | null;
    estado_mora: string | null;
    fecha_entrada_bucket: string | null;
  }>(sql`
    WITH actual AS (
      SELECT
        c.credito_id,
        c.numero_credito_sifco,
        (c."statusCredit" IN (${fueraSql})) AS fuera,
        ${bucketActualSql("c", "m")} AS bucket
      FROM ${SQL_CARTERA_SCHEMA}.creditos c
      LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
        ON m.credito_id = c.credito_id AND m.activa = true
      WHERE c.numero_credito_sifco = ${numero_credito_sifco}
      LIMIT 1
    ),
    -- Última fila de historial del crédito. El WHERE por credito_id acota el
    -- DISTINCT ON a UN crédito (sin él escanearía el historial completo) y cae
    -- justo sobre buckets_historial_credito_fecha_idx
    -- (credito_id, fecha DESC, historial_id DESC).
    ultima_entrada AS (
      SELECT DISTINCT ON (h.credito_id)
        h.credito_id, h.bucket_nuevo, h.fecha
      FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = (SELECT a.credito_id FROM actual a)
      ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
    )
    SELECT
      a.credito_id,
      a.numero_credito_sifco,
      a.fuera,
      CASE WHEN a.fuera THEN NULL ELSE a.bucket END AS bucket,
      -- Solo hay fecha de entrada confiable si el bucket resuelto VIENE de la
      -- última fila de historial. Si ganó un branch de fallback de
      -- bucketActualSql (estado que fuerza bucket / rango de cuotas), no existe
      -- tal fecha: null, no se inventa (mismo criterio "degradar sin inventar
      -- dato" que colaDia.ts, que directamente excluye esos créditos).
      CASE
        WHEN a.fuera THEN NULL
        WHEN ue.bucket_nuevo IS NOT NULL AND ue.bucket_nuevo = a.bucket
          THEN ue.fecha::text
        ELSE NULL
      END AS fecha_entrada_bucket,
      b.prefijo, b.nombre, b.color, b.estado_mora
    FROM actual a
    LEFT JOIN ultima_entrada ue ON ue.credito_id = a.credito_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.buckets b
      ON b.numero = a.bucket AND b.activo = true AND a.fuera = false
  `);

  const row = res.rows?.[0];
  if (!row) return null;
  return {
    credito_id: Number(row.credito_id),
    numero_credito_sifco: row.numero_credito_sifco,
    bucket: row.fuera || row.bucket == null ? null : Number(row.bucket),
    prefijo: row.prefijo ?? null,
    nombre: row.nombre ?? null,
    color: row.color ?? null,
    estado_mora: row.estado_mora ?? null,
    fuera_funnel: Boolean(row.fuera),
    fecha_entrada_bucket: row.fecha_entrada_bucket ?? null,
  };
}
