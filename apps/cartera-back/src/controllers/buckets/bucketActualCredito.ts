import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import {
  bucketActualSql,
  STATUS_READER_FUERA,
} from "../../lib/buckets-classification";

export type BucketActualCredito = {
  credito_id: number;
  numero_credito_sifco: string;
  bucket: number | null;
  prefijo: string | null;
  nombre: string | null;
  color: string | null;
  estado_mora: string | null;
  /** true = statusCredit en STATUS_READER_FUERA (CANCELADO/PENDIENTE_CANCELACION/CAIDO): sin bucket POR DISEÑO. EN_CONVENIO NO va acá: sí se muestra su bucket (lo lleva el job de convenios). */
  fuera_funnel: boolean;
  /**
   * CB-027: último bucket registrado en buckets_historial, SIN el filtro de
   * fuera_funnel que sí aplica a `bucket`. Cuando el crédito sale del funnel
   * (p.ej. EN_CONVENIO), el motor deja de escribir transiciones para él
   * (`if (bucketNuevo === null) continue`, latefee.ts) — la última fila queda
   * congelada en el bucket real previo a la salida. null = sin traza en
   * historial (crédito nunca procesado por el motor).
   */
  bucket_previo: number | null;
  bucket_previo_prefijo: string | null;
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
    STATUS_READER_FUERA.map((s) => sql`${s}`),
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
    bucket_previo: number | null;
    bucket_previo_prefijo: string | null;
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
      -- ue.fecha es un timestamp SIN zona (columna timestamp, no timestamptz;
      -- servidor en GMT/UTC, verificado con SHOW timezone). Un ::text directo
      -- da "2026-07-08 15:30:00" sin ningún indicio de zona — new Date() del
      -- lado del CRM lo reinterpreta como hora LOCAL del proceso Node/Bun, no
      -- UTC, corriendo la ventana de gestión B1 hasta 6h si ese proceso no
      -- corre en UTC (findings de Codex en PR #1204). AT TIME ZONE 'UTC'
      -- convierte a timestamptz ETIQUETANDO el valor como UTC (no lo
      -- desplaza, el servidor ya guarda en UTC) y to_json sobre eso sí emite
      -- el offset +00:00 explícito — TZ-independiente en new Date(), igual
      -- que fechaContacto (que llega vía Date real de drizzle, siempre UTC).
      CASE
        WHEN a.fuera THEN NULL
        WHEN ue.bucket_nuevo IS NOT NULL AND ue.bucket_nuevo = a.bucket
          THEN to_json(ue.fecha AT TIME ZONE 'UTC')#>>'{}'
        ELSE NULL
      END AS fecha_entrada_bucket,
      b.prefijo, b.nombre, b.color, b.estado_mora,
      ue.bucket_nuevo AS bucket_previo,
      bp.prefijo AS bucket_previo_prefijo
    FROM actual a
    LEFT JOIN ultima_entrada ue ON ue.credito_id = a.credito_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.buckets b
      ON b.numero = a.bucket AND b.activo = true AND a.fuera = false
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.buckets bp
      ON bp.numero = ue.bucket_nuevo AND bp.activo = true
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
    bucket_previo: row.bucket_previo == null ? null : Number(row.bucket_previo),
    bucket_previo_prefijo: row.bucket_previo_prefijo ?? null,
  };
}
