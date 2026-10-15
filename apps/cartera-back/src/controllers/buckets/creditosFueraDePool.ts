import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA as schema } from "../../database/db/schema";
import {
  bucketActualSql,
  STATUS_BUCKET_FUERA,
  STATUS_READER_FUERA,
} from "../../lib/buckets-classification";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Cola de créditos FUERA DE POOL (2026-10-15).
//
// Un crédito del funnel cuyo asesor no está en el pool activo de su bucket
// actual (o que no tiene asesor) no lo atiende nadie que deba atenderlo. El
// motor los concilia cada noche; esta lectura muestra los que quedan: los que
// no tienen a nadie elegible en el pool, los de un asesor con ausencia abierta
// y los que entraron después de la última corrida. La usan
// `GET /buckets/creditos-fuera-de-pool` y el script de saneamiento.
//
// Elegible = fila activa de `asesor_bucket` y asesor activo, igual que el motor
// y la reasignación en bloque. El bucket es `bucketActualSql`, la misma
// derivación que el listado por bucket y la reasignación manual.
// ─────────────────────────────────────────────────────────────────────────────

export type CreditoFueraDePool = {
  credito_id: number;
  numero_credito_sifco: string;
  status_credito: string;
  bucket: number;
  asesor_id: number | null;
  asesor_nombre: string | null;
  /** Asesores elegibles del bucket, por id. Vacío = no hay a quién dárselo. */
  pool_del_bucket: number[];
};

type Ejecutor = Pick<typeof db, "execute">;

/**
 * Créditos con un asesor que no atiende su bucket actual.
 *
 * Por defecto deja afuera EN_CONVENIO: el convenio congela bucket y asesor
 * (decisión 9 del plan 08) y el motor no los concilia. Con `incluirConvenios`
 * salen también, para revisarlos a mano.
 */
export async function getCreditosFueraDePool(
  opciones: { incluirConvenios?: boolean } = {},
  ejecutor: Ejecutor = db,
): Promise<CreditoFueraDePool[]> {
  const fuera = opciones.incluirConvenios ? STATUS_READER_FUERA : STATUS_BUCKET_FUERA;
  const fueraSql = sql.join(fuera.map((s) => sql`${s}`), sql`, `);
  const res = await ejecutor.execute<{
    credito_id: number;
    numero_credito_sifco: string;
    status_credito: string;
    bucket: number;
    asesor_id: number | null;
    asesor_nombre: string | null;
    pool_del_bucket: number[] | null;
  }>(sql`
    WITH pool AS (
      SELECT ab.bucket, array_agg(ab.asesor_id ORDER BY ab.asesor_id) AS asesores
      FROM ${schema}.asesor_bucket ab
      JOIN ${schema}.asesores a ON a.asesor_id = ab.asesor_id
      WHERE ab.activo AND a.activo
      GROUP BY ab.bucket
    ),
    actual AS (
      SELECT
        c.credito_id,
        c.numero_credito_sifco,
        c."statusCredit" AS status_credito,
        c.asesor_id,
        ${bucketActualSql("c", "m")} AS bucket
      FROM ${schema}.creditos c
      LEFT JOIN ${schema}.moras_credito m
        ON m.credito_id = c.credito_id AND m.activa = true
      WHERE c."statusCredit" NOT IN (${fueraSql})
    )
    SELECT
      x.credito_id,
      x.numero_credito_sifco,
      x.status_credito,
      x.bucket,
      x.asesor_id,
      ase.nombre AS asesor_nombre,
      COALESCE(p.asesores, ARRAY[]::int[]) AS pool_del_bucket
    FROM actual x
    LEFT JOIN pool p ON p.bucket = x.bucket
    LEFT JOIN ${schema}.asesores ase ON ase.asesor_id = x.asesor_id
    WHERE x.bucket IS NOT NULL
      AND (x.asesor_id IS NULL OR NOT (x.asesor_id = ANY (COALESCE(p.asesores, ARRAY[]::int[]))))
    ORDER BY x.bucket DESC, x.credito_id
  `);
  return (res.rows ?? []).map((r) => ({
    credito_id: Number(r.credito_id),
    numero_credito_sifco: r.numero_credito_sifco,
    status_credito: r.status_credito,
    bucket: Number(r.bucket),
    asesor_id: r.asesor_id === null ? null : Number(r.asesor_id),
    asesor_nombre: r.asesor_nombre ?? null,
    pool_del_bucket: (r.pool_del_bucket ?? []).map(Number),
  }));
}

/**
 * Asesores activos con una ausencia abierta (traslado confirmado con `ausente`).
 * Mientras se les devuelve la cartera tienen cuentas en buckets donde su pool
 * sigue pausado: ni el motor ni el saneamiento se las quitan.
 */
export async function getAsesoresConAusenciaAbierta(ejecutor: Ejecutor = db): Promise<Set<number>> {
  const res = await ejecutor.execute<{ asesor_origen_id: number }>(sql`
    SELECT DISTINCT o.asesor_origen_id
    FROM ${schema}.operaciones_traslado_cartera o
    JOIN ${schema}.asesores a ON a.asesor_id = o.asesor_origen_id
    WHERE o.estado = 'confirmada'
      AND o.solicitud->>'ausente' = 'true'
      AND a.activo
  `);
  return new Set((res.rows ?? []).map((r) => Number(r.asesor_origen_id)));
}
