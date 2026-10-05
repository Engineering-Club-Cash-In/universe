/**
 * COBROS-02 — catálogo dinámico de buckets (con fallback) y elección de asesor
 * para un crédito que entra a un bucket. Antes vivía en latefee.ts; se movió
 * en el merge con develop porque latefee.ts solo emite eventos estructurados
 * (`latefeeStructuredLogging.test.ts`) y esto loguea con console. latefee.ts
 * lo re-exporta.
 */
import { eq } from "drizzle-orm";
import { db } from "../../database";
import { buckets } from "../../database/db/schema";
import { validarCatalogoBuckets } from "../../lib/buckets-validation";
import type { BucketCatalogoCompleto } from "../../lib/buckets-classification";

// Fallback B0-B5 — mismo seed seed que 0001_buckets_catalogo.sql +
// 0003_buckets_estado_mora.sql. Usado SOLO si la query falla (ej. columna
// `estado_mora` aún no existe porque la migración 0003 está pendiente en ese
// ambiente): sin esto, GET /config/buckets devolvía 500 en vez de degradar,
// a diferencia de los demás consumidores de getBucketsCatalogo() en credits.ts.
export const FALLBACK_BUCKETS_CATALOGO: BucketCatalogoCompleto[] = [
  { numero: 0, prefijo: "B0", nombre: "Cartera Sana", descripcion: null, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [], estados_piso: [], es_operativo: true, orden: 0, color: null, estado_mora: "al_dia", dias_sla: null },
  { numero: 1, prefijo: "B1", nombre: "Alerta Temprana", descripcion: null, cuotas_min: 1, cuotas_max: 1, estados_incluidos: [], estados_piso: [], es_operativo: true, orden: 1, color: null, estado_mora: "mora_30", dias_sla: 3 },
  { numero: 2, prefijo: "B2", nombre: "Gestión Activa", descripcion: null, cuotas_min: 2, cuotas_max: 2, estados_incluidos: [], estados_piso: [], es_operativo: true, orden: 2, color: null, estado_mora: "mora_60", dias_sla: 3 },
  { numero: 3, prefijo: "B3", nombre: "Rescate", descripcion: null, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [], estados_piso: [], es_operativo: true, orden: 3, color: null, estado_mora: "mora_90", dias_sla: 2 },
  { numero: 4, prefijo: "B4", nombre: "Última Instancia / Pre Jurídico", descripcion: null, cuotas_min: 4, cuotas_max: 4, estados_incluidos: [], estados_piso: ["EN_RECUPERACION"], es_operativo: true, orden: 4, color: null, estado_mora: "mora_120", dias_sla: 2 },
  { numero: 5, prefijo: "B5", nombre: "Jurídico", descripcion: null, cuotas_min: 5, cuotas_max: null, estados_incluidos: ["INCOBRABLE"], estados_piso: [], es_operativo: false, orden: 5, color: null, estado_mora: "mora_120_plus", dias_sla: 1 },
];

export type CatalogoBucketsResultado = {
  catalogo: BucketCatalogoCompleto[];
  /** true si `catalogo` es FALLBACK_BUCKETS_CATALOGO (DB inconsistente/caída), no la config real. */
  esFallback: boolean;
};

/**
 * Catálogo dinámico de buckets (activos, ordenados) — fuente única para
 * cartera-back y CRM. Expone si el resultado es el fallback hardcoded para
 * que consumidores que ESCRIBEN datos derivados (el motor de buckets, más
 * abajo) puedan negarse a persistir con config potencialmente incorrecta —
 * los consumidores de solo-lectura/presentación (credits.ts, router) usan
 * getBucketsCatalogo() y aceptan degradar en silencio, como antes.
 */
export async function getBucketsCatalogoConEstado(): Promise<CatalogoBucketsResultado> {
  try {
    const rows = await db
      .select({
        numero: buckets.numero,
        prefijo: buckets.prefijo,
        nombre: buckets.nombre,
        descripcion: buckets.descripcion,
        cuotas_min: buckets.cuotas_min,
        cuotas_max: buckets.cuotas_max,
        estados_incluidos: buckets.estados_incluidos,
        estados_piso: buckets.estados_piso,
        es_operativo: buckets.es_operativo,
        orden: buckets.orden,
        color: buckets.color,
        estado_mora: buckets.estado_mora,
        dias_sla: buckets.dias_sla,
      })
      .from(buckets)
      .where(eq(buckets.activo, true))
      .orderBy(buckets.orden);

    const { ok, problemas } = validarCatalogoBuckets(rows);
    if (!ok) {
      console.error(
        `❌ Catálogo de buckets inconsistente, usando fallback: ${problemas.join(" | ")}`,
      );
      return { catalogo: FALLBACK_BUCKETS_CATALOGO, esFallback: true };
    }

    return { catalogo: rows, esFallback: false };
  } catch (err) {
    console.error("❌ Error consultando catálogo de buckets, usando fallback:", err);
    return { catalogo: FALLBACK_BUCKETS_CATALOGO, esFallback: true };
  }
}

/** Catálogo dinámico de buckets (activos, ordenados) — fuente única para cartera-back y CRM. */
export async function getBucketsCatalogo(): Promise<BucketCatalogoCompleto[]> {
  const { catalogo } = await getBucketsCatalogoConEstado();
  return catalogo;
}

/**
 * FASE 3 — elige el asesor para un crédito que ENTRA a un bucket:
 *  · pool vacío → null (no hay elegibles; el crédito conserva su asesor)
 *  · el asesor actual ya es elegible en el bucket destino → se queda (sin churn)
 *  · si no → el elegible con MENOR carga en ese bucket (asignación equitativa
 *    cuando hay N asesores; con 1 solo, queda directa); empate → menor asesor_id.
 * Pura a propósito (sin DB) para poder testearla aislada.
 */
export function elegirAsesorParaBucket(
  pool: number[],
  cargaBucket: Map<number, number> | undefined,
  asesorActual: number | null,
): number | null {
  if (pool.length === 0) return null;
  if (asesorActual !== null && pool.includes(asesorActual)) return asesorActual;
  let elegido: number | null = null;
  let menorCarga = Infinity;
  for (const asesorId of pool) {
    const carga = cargaBucket?.get(asesorId) ?? 0;
    if (carga < menorCarga || (carga === menorCarga && elegido !== null && asesorId < elegido)) {
      menorCarga = carga;
      elegido = asesorId;
    }
  }
  return elegido;
}
