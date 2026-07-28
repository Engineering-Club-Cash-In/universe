import { and, eq } from "drizzle-orm";
import { db } from "../../database";
import { asesor_bucket, asesores } from "../../database/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Pool por asesor (contraparte "invertida" de /buckets/pool/:bucket, que da los
// asesores de UN bucket) — CRM (Cierre diario) necesitaba "a qué bucket(s)
// pertenece cada asesor" sin depender de creditos (getCargaPorAsesorBucket
// solo lista asesores con al menos un crédito ACTUALMENTE en el funnel
// operativo, perdiendo asesores sin cuentas activas en ese momento) ni del
// email de /advisor (desactualizado para varios asesores). email_cash_in sí
// es el campo que coincide con el email real del usuario en el CRM.
// ─────────────────────────────────────────────────────────────────────────────

export type AsesorConBuckets = {
  asesor_id: number;
  nombre: string;
  email_cash_in: string | null;
  buckets: number[];
};

/**
 * TODOS los asesores con sus buckets activos del pool (asesor_bucket WHERE
 * activo=true), SIN filtrar por créditos actuales. Un asesor sin ninguna fila
 * activa en asesor_bucket no aparece en el resultado (sin pool asignado).
 */
export async function getPoolPorAsesor(): Promise<AsesorConBuckets[]> {
  const rows = await db
    .select({
      asesor_id: asesores.asesor_id,
      nombre: asesores.nombre,
      email_cash_in: asesores.emailCashIn,
      bucket: asesor_bucket.bucket,
    })
    .from(asesores)
    .innerJoin(
      asesor_bucket,
      and(eq(asesor_bucket.asesor_id, asesores.asesor_id), eq(asesor_bucket.activo, true)),
    )
    .orderBy(asesores.nombre, asesor_bucket.bucket);

  const porAsesor = new Map<number, AsesorConBuckets>();
  for (const r of rows) {
    if (!porAsesor.has(r.asesor_id)) {
      porAsesor.set(r.asesor_id, {
        asesor_id: r.asesor_id,
        nombre: r.nombre,
        email_cash_in: r.email_cash_in,
        buckets: [],
      });
    }
    porAsesor.get(r.asesor_id)!.buckets.push(r.bucket);
  }
  return Array.from(porAsesor.values());
}
