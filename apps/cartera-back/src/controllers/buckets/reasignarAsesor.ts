import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import {
  asesor_bucket,
  asesores,
  credito_asesor_historial,
  creditos,
  platform_users,
  SQL_CARTERA_SCHEMA,
} from "../../database/db/schema";
import { bucketActualSql, STATUS_BUCKET_FUERA } from "../../lib/buckets-classification";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Buckets — Reasignación MANUAL de asesor (supervisor/gerente).
// Contraparte manual del motor automático (controllers/latefee.ts): mismo par
// UPDATE creditos.asesor_id + INSERT credito_asesor_historial en una transacción
// (decisión de raíz, schema.ts:527-549), pero con origen=API_MANUAL, el usuario_id
// del que lo hizo y motivo OBLIGATORIO. Solo se permite reasignar a un asesor que
// ya esté en el pool (asesor_bucket) del bucket ACTUAL del crédito.
// ─────────────────────────────────────────────────────────────────────────────

export type PoolAsesor = { asesor_id: number; nombre: string };

/**
 * Asesores elegibles (pool activo) de un bucket. Alimenta el dropdown del modal
 * de reasignación en el CRM y es la misma fuente que valida el server-side.
 */
export async function getAsesoresPorBucket(bucket: number): Promise<PoolAsesor[]> {
  const rows = await db
    .select({ asesor_id: asesor_bucket.asesor_id, nombre: asesores.nombre })
    .from(asesor_bucket)
    .innerJoin(asesores, eq(asesores.asesor_id, asesor_bucket.asesor_id))
    .where(and(eq(asesor_bucket.bucket, bucket), eq(asesor_bucket.activo, true)))
    .orderBy(asesores.nombre);
  return rows;
}

/**
 * Bucket ACTUAL de un crédito — misma fuente que el listado /buckets/creditos
 * (getCreditosWithUserByMesAnio): COALESCE(último de buckets_historial → estado
 * que fuerza bucket vía estados_incluidos → rango de cuotas de la mora activa).
 * Devuelve null si el crédito está fuera del funnel operativo (no se reasigna).
 */
async function bucketActualDeCredito(credito_id: number): Promise<number | null> {
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
  const res = await db.execute<{ bucket: number | null; fuera: boolean }>(sql`
    SELECT
      (c."statusCredit" IN (${fueraSql})) AS fuera,
      ${bucketActualSql("c", "m")} AS bucket
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.credito_id = ${credito_id}
    LIMIT 1
  `);
  const row = res.rows?.[0];
  if (!row) return null;
  if (row.fuera) return null;
  return row.bucket === null || row.bucket === undefined ? null : Number(row.bucket);
}

export type ReasignarAsesorResultado =
  | {
      success: true;
      credito_id: number;
      asesor_anterior: number | null;
      asesor_nuevo: number;
      bucket: number;
    }
  | { success: false; message: string; status?: number };

/**
 * Reasigna MANUALMENTE el asesor de un crédito. Solo a un asesor del pool del
 * bucket actual. Escribe la bitácora (origen=API_MANUAL, usuario_id, motivo) y
 * actualiza creditos.asesor_id — ÚNICAMENTE ese campo — en una transacción.
 */
export async function reasignarAsesorManual(params: {
  credito_id: number;
  asesor_nuevo_id: number;
  motivo: string;
  usuario_email?: string;
}): Promise<ReasignarAsesorResultado> {
  const { credito_id, asesor_nuevo_id } = params;
  const motivo = (params.motivo ?? "").trim();

  // 1. Motivo obligatorio (auditoría).
  if (!motivo) {
    return { success: false, status: 400, message: "[ERROR] El motivo es obligatorio" };
  }

  // 2. Crédito + asesor actual.
  const [credito] = await db
    .select({ asesor_id: creditos.asesor_id })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id));
  if (!credito) {
    return { success: false, status: 404, message: `[ERROR] No se encontró crédito con credito_id=${credito_id}` };
  }
  const asesorActual = credito.asesor_id ?? null;

  // 3. Bucket actual (misma derivación que el listado).
  const bucket = await bucketActualDeCredito(credito_id);
  if (bucket === null) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] El crédito está fuera del funnel operativo (sin bucket): no se reasigna.",
    };
  }

  // 4. Elegibilidad: el asesor destino debe estar en el pool del bucket actual.
  const pool = await getAsesoresPorBucket(bucket);
  if (!pool.some((a) => a.asesor_id === asesor_nuevo_id)) {
    return {
      success: false,
      status: 400,
      message: `[ERROR] El asesor ${asesor_nuevo_id} no es elegible en el bucket B${bucket} (no está en el pool activo).`,
    };
  }

  // 5. No-op: ya es el dueño actual.
  if (asesorActual === asesor_nuevo_id) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] El crédito ya está asignado a ese asesor.",
    };
  }

  // 6. Resolver identidad del supervisor por email → platform_users.id
  //    (best-effort, patrón de createMora: no bloquea la operación si no resuelve).
  let usuarioId: number | null = null;
  if (params.usuario_email) {
    const [u] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, params.usuario_email));
    usuarioId = u?.id ?? null;
  }

  // 7. Transacción: bitácora PRIMERO, luego UPDATE (mismo par que el motor auto).
  await db.transaction(async (tx) => {
    await tx.insert(credito_asesor_historial).values({
      credito_id,
      asesor_anterior: asesorActual,
      asesor_nuevo: asesor_nuevo_id,
      bucket,
      origen: "API_MANUAL",
      motivo,
      usuario_id: usuarioId,
    });
    await tx
      .update(creditos)
      .set({ asesor_id: asesor_nuevo_id })
      .where(eq(creditos.credito_id, credito_id));
  });

  return {
    success: true,
    credito_id,
    asesor_anterior: asesorActual,
    asesor_nuevo: asesor_nuevo_id,
    bucket,
  };
}
