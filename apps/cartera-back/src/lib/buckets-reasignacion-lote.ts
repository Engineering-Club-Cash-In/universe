// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Reasignación MANUAL en bloque (S6, issue #1891).
// Reglas puras del lote: decide, sin tocar la base, qué créditos se reasignan,
// cuáles se omiten y cuáles impiden todo el lote. La escritura es todo o nada
// (controllers/buckets/reasignarAsesorLote.ts): si hay un solo error, no se
// escribe nada.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_CREDITOS_LOTE = 200;
/** Máximo de un `integer` de PostgreSQL: `credito_id` y `asesor_id` son int4. */
export const MAX_ID_INT4 = 2_147_483_647;

export type CodigoErrorLote =
  | "no_encontrado"
  | "fuera_del_funnel"
  | "asesor_no_elegible";

export interface ErrorLote {
  credito_id: number;
  codigo: CodigoErrorLote;
  message: string;
}

export interface CreditoLoteLeido {
  asesor_id: number | null;
  /** Bucket actual (motor); null = fuera del funnel operativo. */
  bucket: number | null;
  /** Cancelado, pendiente de cancelación o caído (distinto de EN_CONVENIO). */
  cerrado?: boolean;
}

export interface EvaluacionLote {
  /** Créditos a escribir, con el dueño leído (para el compare-and-swap). */
  aReasignar: Array<{
    credito_id: number;
    asesor_anterior: number | null;
    bucket: number;
  }>;
  /** Ya eran del asesor destino: no es un error, no se escribe. */
  omitidos: Array<{ credito_id: number; motivo: "ya_asignado" }>;
  errores: ErrorLote[];
}

/**
 * Validación del lote con la MISMA regla que `reasignarAsesorManual`:
 * el crédito existe, está dentro del funnel y el asesor destino está en el
 * pool activo de su bucket actual. Un crédito que ya es del destino se omite
 * antes de evaluar la elegibilidad (no requiere escritura).
 */
export function evaluarLote(params: {
  creditoIds: readonly number[];
  /** null = el crédito no existe. */
  creditos: ReadonlyMap<number, CreditoLoteLeido | null>;
  /** bucket → ids de asesor del pool activo. */
  poolPorBucket: ReadonlyMap<number, ReadonlySet<number>>;
  asesorNuevoId: number;
}): EvaluacionLote {
  const resultado: EvaluacionLote = { aReasignar: [], omitidos: [], errores: [] };
  for (const creditoId of params.creditoIds) {
    const leido = params.creditos.get(creditoId);
    if (!leido) {
      resultado.errores.push({
        credito_id: creditoId,
        codigo: "no_encontrado",
        message: `No se encontró el crédito ${creditoId}.`,
      });
      continue;
    }
    // Ya es del destino: no hay nada que escribir, así que no se le exige
    // elegibilidad (pudo salir del pool o cambiar de bucket después de la
    // asignación); el reintento de un lote no debe fallar por eso.
    if (leido.asesor_id === params.asesorNuevoId) {
      resultado.omitidos.push({ credito_id: creditoId, motivo: "ya_asignado" });
      continue;
    }
    if (leido.bucket === null) {
      resultado.errores.push({
        credito_id: creditoId,
        codigo: "fuera_del_funnel",
        message: `El crédito ${creditoId} está fuera del funnel operativo (sin bucket): no se reasigna.`,
      });
      continue;
    }
    if (!params.poolPorBucket.get(leido.bucket)?.has(params.asesorNuevoId)) {
      resultado.errores.push({
        credito_id: creditoId,
        codigo: "asesor_no_elegible",
        message: `El asesor ${params.asesorNuevoId} no es elegible en B${leido.bucket} (crédito ${creditoId}): no está en el pool activo.`,
      });
      continue;
    }
    resultado.aReasignar.push({
      credito_id: creditoId,
      asesor_anterior: leido.asesor_id,
      bucket: leido.bucket,
    });
  }
  return resultado;
}

/** Ids únicos, enteros positivos y dentro del tope; null si algo no cuadra. */
export function normalizarCreditoIds(crudo: unknown): number[] | null {
  if (!Array.isArray(crudo) || crudo.length === 0) return null;
  const ids = crudo.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0 || n > MAX_ID_INT4)) {
    return null;
  }
  const unicos = [...new Set(ids)];
  return unicos.length > MAX_CREDITOS_LOTE ? null : unicos;
}
