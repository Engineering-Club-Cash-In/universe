import { lockPool } from "../database";

// ================================================================
// Advisory lock por crédito para las operaciones sobre el espejo
// (addInvestorToCredit: compra de cartera / reinversión).
// ================================================================
//
// Namespace PROPIO, distinto del de pagos (PAYMENT_ADVISORY_LOCK_NAMESPACE =
// 8765, en paymentAdvisoryLock.ts). La exclusión que hace falta es
// reinversión-vs-reinversión sobre el mismo crédito; compartir namespace con
// los pagos dejaría el procesamiento de pagos esperando detrás de una
// transacción de reinversión, que es larga.
//
// 📌 Namespaces de advisory locks en uso — revisar antes de agregar otro:
//      8765 → pagos   (paymentAdvisoryLock.ts)
//      8766 → espejo  (este archivo)
export const ESPEJO_ADVISORY_LOCK_NAMESPACE = 8766;

// ⚠️ COBERTURA PARCIAL: hoy este lock lo toma únicamente addInvestorToCredit.
// `replaceInvestorCredit.ts` hace el mismo nuke&rebuild del espejo en :620,
// :1243 y :1527 SIN tomarlo. O sea: addInvestor-vs-addInvestor ya está
// serializado, pero addInvestor-vs-replace todavía no. La relectura dentro de
// la transacción mitiga (ambas leen bajo `tx` y el DELETE serializa las
// escrituras), pero en READ COMMITTED dos transacciones pueden pasar el guard
// antes de que cualquiera borre. Extender el lock a replaceInvestorCredit es
// trabajo aparte; no asumir cobertura total.

type LockConnection = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

export type CreditoEspejoLocks = {
  /**
   * Intenta tomar el lock del crédito SIN esperar.
   * `true` = lo tenemos (o ya lo teníamos), `false` = otro proceso lo tiene.
   */
  tryLock: (credito_id: number) => Promise<boolean>;
};

/**
 * Lee el booleano de `SELECT pg_try_advisory_lock(...) AS ok`.
 *
 * Falla FUERTE ante una forma inesperada en vez de devolver `false`: un
 * `false` silencioso haría que se saltaran TODOS los créditos y la operación
 * respondiera 200 con cero colocaciones y sin ninguna alarma. Una respuesta
 * que no se puede interpretar es un bug del driver, no contención.
 */
function leerOk(resultado: unknown): boolean {
  const filas = (resultado as { rows?: unknown[] } | null | undefined)?.rows;
  if (!Array.isArray(filas) || filas.length === 0) {
    throw new Error(
      `[creditoEspejoLock] Respuesta inesperada de pg_try_advisory_lock: ${JSON.stringify(resultado)}`,
    );
  }
  const ok = (filas[0] as { ok?: unknown }).ok;
  // node-postgres mapea `bool` a boolean de JS siempre; no hace falta
  // aceptar formas textuales ("t"/"true") que ese driver nunca produce.
  if (ok === true) return true;
  if (ok === false) return false;
  throw new Error(
    `[creditoEspejoLock] Valor no booleano en pg_try_advisory_lock: ${JSON.stringify(ok)}`,
  );
}

/**
 * Corre `fn` pudiendo tomar advisory locks por crédito, todos sobre UNA sola
 * conexión del pool DEDICADO (`lockPool`), liberados al terminar.
 *
 * Dos decisiones importantes:
 *
 * 1. **No bloqueante** (`pg_try_advisory_lock`, no `pg_advisory_lock`). El
 *    docstring de `paymentAdvisoryLock.ts` advierte que un waiter retiene su
 *    conexión mientras espera y puede agotar el pool. Con la variante *try*
 *    no hay waiters: si el crédito está tomado se devuelve `false` y quien
 *    llama decide (acá: saltar el crédito y seguir con el siguiente).
 *
 * 2. **Una conexión para todos los locks.** Una sesión puede sostener N
 *    advisory locks; pedir una conexión por crédito agotaría `lockPool`
 *    (max 10) en una reinversión que se reparte entre muchos créditos.
 *
 * Los locks se liberan cuando `fn` termina, así que hay que envolver con esto
 * la transacción COMPLETA: soltarlos crédito por crédito dentro del loop
 * dejaría que otro proceso lo tomara con nuestra transacción todavía abierta,
 * que es exactamente la carrera que se quiere cerrar.
 */
export async function withCreditoEspejoLocks<T>(
  fn: (locks: CreditoEspejoLocks) => Promise<T>,
): Promise<T> {
  const conn: LockConnection = await lockPool.connect();
  // `pg_advisory_lock` es reentrante: tomar dos veces la misma llave exige dos
  // unlocks. Lo registramos para no re-lockear ni dejar locks colgados.
  const tomados = new Set<number>();

  try {
    const locks: CreditoEspejoLocks = {
      tryLock: async (credito_id: number) => {
        if (tomados.has(credito_id)) return true;
        const resultado = await conn.query(
          "SELECT pg_try_advisory_lock($1, $2) AS ok",
          [ESPEJO_ADVISORY_LOCK_NAMESPACE, credito_id],
        );
        const ok = leerOk(resultado);
        if (ok) tomados.add(credito_id);
        return ok;
      },
    };

    return await fn(locks);
  } finally {
    for (const credito_id of tomados) {
      try {
        await conn.query("SELECT pg_advisory_unlock($1, $2)", [
          ESPEJO_ADVISORY_LOCK_NAMESPACE,
          credito_id,
        ]);
      } catch (unlockError) {
        console.error(
          `⚠️ Error liberando advisory lock del crédito ${credito_id}:`,
          unlockError,
        );
      }
    }
    conn.release();
  }
}
