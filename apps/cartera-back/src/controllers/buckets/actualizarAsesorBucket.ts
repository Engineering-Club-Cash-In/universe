import { and, eq } from "drizzle-orm";
import { db } from "../../database";
import { asesor_bucket } from "../../database/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// CB-019 · Buckets — Escritura de capacidad/margen de alerta por asesor+bucket
// (desde el CRM). Contraparte de escritura de lo que CB-018 dejó solo-lectura
// (ver guardia en cargaAsesorBucket.ts): antes SOLO se editaba a mano por SQL;
// ahora existe este camino explícito, separado a propósito de
// cargaAsesorBucket.ts (que sigue siendo solo-lectura).
//
// Solo EDITA filas existentes del pool (asesor_bucket) — no crea filas nuevas.
// Si el asesor no está en el pool de ese bucket, error (no hay "alta" implícita
// de pool aquí; eso es un flujo aparte).
// ─────────────────────────────────────────────────────────────────────────────

export type MargenAlertaTipo = "porcentaje" | "fijo";

export type ActualizarCapacidadAsesorBucketResultado =
  | { success: true; asesor_id: number; bucket: number }
  | { success: false; status: number; message: string };

export async function actualizarCapacidadAsesorBucket(params: {
  asesor_id: number;
  bucket: number;
  capacidad_base: number;
  margen_alerta_tipo: MargenAlertaTipo;
  margen_alerta_valor: number;
}): Promise<ActualizarCapacidadAsesorBucketResultado> {
  const { asesor_id, bucket, capacidad_base, margen_alerta_tipo, margen_alerta_valor } = params;

  // Mismos invariantes que los CHECK de la migración 0004/0005 — validados acá
  // primero para devolver un mensaje claro en vez del error crudo de constraint.
  // Topes de sanidad (review code-review #4/#5) espejados del zod del CRM
  // (cobros.ts actualizarCapacidadAsesorBucket) — no depender solo de esa capa,
  // por si algo pega directo a este endpoint sin pasar por el CRM.
  if (
    !Number.isFinite(capacidad_base) ||
    !Number.isInteger(capacidad_base) ||
    capacidad_base <= 0
  ) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] capacidad_base debe ser un entero mayor a 0",
    };
  }
  if (capacidad_base > 2000) {
    return { success: false, status: 400, message: "[ERROR] capacidad_base no puede ser mayor a 2000" };
  }
  if (!Number.isFinite(margen_alerta_valor) || margen_alerta_valor < 0) {
    return { success: false, status: 400, message: "[ERROR] margen_alerta_valor debe ser mayor o igual a 0" };
  }
  if (margen_alerta_tipo !== "porcentaje" && margen_alerta_tipo !== "fijo") {
    return { success: false, status: 400, message: "[ERROR] margen_alerta_tipo debe ser 'porcentaje' o 'fijo'" };
  }
  if (margen_alerta_tipo === "porcentaje" && margen_alerta_valor > 100) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] margen_alerta_valor debe ser menor o igual a 100 cuando el tipo es porcentaje",
    };
  }
  if (margen_alerta_tipo === "fijo" && margen_alerta_valor > 500) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] margen_alerta_valor no puede ser mayor a 500 cuando el tipo es fijo",
    };
  }

  const [existente] = await db
    .select({ id: asesor_bucket.id })
    .from(asesor_bucket)
    .where(and(eq(asesor_bucket.asesor_id, asesor_id), eq(asesor_bucket.bucket, bucket)));

  if (!existente) {
    return {
      success: false,
      status: 404,
      message: `[ERROR] El asesor ${asesor_id} no está en el pool del bucket B${bucket}`,
    };
  }

  await db
    .update(asesor_bucket)
    .set({
      capacidad_base,
      margen_alerta_tipo,
      margen_alerta_valor: margen_alerta_valor.toString(),
      updated_at: new Date(),
    })
    .where(and(eq(asesor_bucket.asesor_id, asesor_id), eq(asesor_bucket.bucket, bucket)));

  return { success: true, asesor_id, bucket };
}
