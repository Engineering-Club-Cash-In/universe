import type { creditos_inversionistas_espejo } from "../database/db/schema";

// ================================================================
// Guards del espejo (creditos_inversionistas_espejo)
// ================================================================
//
// El nuke&rebuild del espejo (addInvestorToCredit PASO 3i) borra TODAS las
// filas del crédito y las reinserta. Si al reinsertar se le inventa el status
// a los inversionistas que no son el que entra, se pierde la operación en
// vuelo de un tercero: su fila queda "completado" sin que nadie la haya
// confirmado, mientras su registro en compras_credito_inversionista sigue
// pendiente para siempre (y deja de aparecer en la pantalla de pendientes,
// que filtra por el status del espejo).
//
// Estas funciones son puras a propósito: se usan tanto en la validación
// pre-transacción del modo manual como dentro de la transacción, sobre filas
// releídas con `tx`.
// ================================================================

/**
 * Status posibles del espejo, derivado del enum del schema para que agregar un
 * valor nuevo rompa acá y no se cuele un cast mentiroso.
 * Hoy: pendiente_reinversion | pendiente_compra_cartera | completado | pendiente_revision
 */
export type EspejoStatus =
  typeof creditos_inversionistas_espejo.$inferSelect.status;

/** Subconjunto de la fila de espejo que necesitan los guards. */
export interface FilaEspejoGuard {
  inversionista_id: number;
  status?: EspejoStatus | null;
}

/**
 * Devuelve la primera fila con una operación en curso (cualquier status que no
 * sea "completado"), o `undefined` si todas están completadas.
 *
 * Un crédito solo es elegible para recibir un inversionista nuevo si TODAS
 * sus filas de espejo están completadas: si alguna está pendiente, ya hay una
 * compra/reinversión en vuelo y el rebuild la pisaría.
 *
 * Las filas sin status (null/undefined) NO cuentan como pendientes: es el
 * caso de créditos sin ciclo previo, que sí son elegibles.
 */
export function operacionEnCursoEnEspejo<T extends FilaEspejoGuard>(
  filas: readonly T[] | null | undefined,
): T | undefined {
  return (filas ?? []).find((f) => f.status && f.status !== "completado");
}

/**
 * Mapa inversionista_id → status actual en el espejo.
 *
 * Se usa al reconstruir el espejo para PRESERVAR el status de los
 * inversionistas que no son el de la operación, en vez de asumir
 * "completado". Mismo patrón que `tipoReinvActualPorInv` y
 * `modalidadFacturacionActualPorInv` en addInvestorToCredit.
 */
export function construirStatusActualPorInv(
  filas: readonly FilaEspejoGuard[] | null | undefined,
): Map<number, EspejoStatus> {
  const mapa = new Map<number, EspejoStatus>();
  for (const f of filas ?? []) {
    if (f.status) mapa.set(f.inversionista_id, f.status);
  }
  return mapa;
}

/**
 * Status que le toca a una fila en el rebuild del espejo.
 *
 * ⚠️ ESTA es la línea que causó la pérdida de julio/agosto 2026: el rebuild
 * hardcodeaba "completado" para todo el que no fuera el inversionista de la
 * operación, dando por confirmada la reinversión en vuelo de un tercero.
 * Vive acá —y no inline en el controller— para que el test la ejerza de
 * verdad y no una copia.
 *
 * - El inversionista de la operación recibe el status nuevo.
 * - Los demás CONSERVAN el que ya tenían.
 * - Sin dato previo (fila nueva) cae a "completado", que es el default de la
 *   columna en el schema.
 */
export function resolverStatusEspejoRebuild(
  inversionista_id: number,
  targetInversionistaId: number,
  statusNuevo: EspejoStatus,
  statusActualPorInv: ReadonlyMap<number, EspejoStatus>,
): EspejoStatus {
  if (inversionista_id === targetInversionistaId) return statusNuevo;
  return statusActualPorInv.get(inversionista_id) ?? "completado";
}
