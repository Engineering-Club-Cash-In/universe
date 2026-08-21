import { lockPool } from "../database";

export const PAYMENT_ADVISORY_LOCK_NAMESPACE = 8765;

export type PaymentAdvisoryLockConnection = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

/**
 * Corre `fn` sosteniendo el advisory lock por crédito, con la conexión del
 * pool DEDICADO de locks (`lockPool`). Los waiters bloqueados en
 * `pg_advisory_lock` retienen su conexión mientras esperan: si esperaran en
 * el pool de trabajo podrían agotarlo y dejar sin conexiones al dueño del
 * lock (deadlock de pool). Por eso NUNCA esperar este lock con conexiones de
 * `client`/`db` (p.ej. `pg_advisory_xact_lock` dentro de una transacción).
 */
export async function withPaymentAdvisoryLock<T>(
  credito_id: number,
  fn: () => Promise<T>
): Promise<T> {
  const lockConn: PaymentAdvisoryLockConnection = await lockPool.connect();
  try {
    await lockConn.query("SELECT pg_advisory_lock($1, $2)", [
      PAYMENT_ADVISORY_LOCK_NAMESPACE,
      credito_id,
    ]);
    return await fn();
  } finally {
    try {
      await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [
        PAYMENT_ADVISORY_LOCK_NAMESPACE,
        credito_id,
      ]);
    } catch (unlockError) {
      console.error("⚠️ Error liberando advisory lock:", unlockError);
    }
    lockConn.release();
  }
}

/**
 * Igual que el anterior pero **sin encolarse**: si el lock ya está tomado,
 * devuelve `{ obtenido: false }` en lugar de esperar.
 *
 * Es lo que necesita una lectura de diagnóstico. Esperar el lock sería a la vez
 * inútil —lo que se quiere saber es justamente si hay algo corriendo— y
 * peligroso: el job de reconciliación se quedaría trabado detrás de un pago
 * lento, sosteniendo una conexión del pool de locks.
 *
 * Sostener el lock mientras se lee sirve para que la foto sea coherente. Sin
 * él, dos lecturas sueltas pueden caer una a cada lado de un `insertPayment`
 * que termina en el medio: la primera no ve las filas porque todavía no se
 * escribieron y la segunda no ve la operación porque ya soltó el lock. Las dos
 * respuestas son ciertas por separado y juntas dicen "acá no pasó nada".
 *
 * `fn` recibe la conexión del lock por si necesita preguntar algo que dependa
 * de ella —el `pg_backend_pid()` propio, por ejemplo—.
 */
export async function tryWithPaymentAdvisoryLock<T>(
  credito_id: number,
  fn: (lockConn: PaymentAdvisoryLockConnection) => Promise<T>
): Promise<{ obtenido: true; valor: T } | { obtenido: false }> {
  const lockConn: PaymentAdvisoryLockConnection = await lockPool.connect();
  let obtenido = false;

  try {
    const res = (await lockConn.query(
      "SELECT pg_try_advisory_lock($1, $2) AS tomado",
      [PAYMENT_ADVISORY_LOCK_NAMESPACE, credito_id]
    )) as { rows?: { tomado?: boolean }[] };

    obtenido = Boolean(res?.rows?.[0]?.tomado);
    if (!obtenido) return { obtenido: false };

    return { obtenido: true, valor: await fn(lockConn) };
  } finally {
    if (obtenido) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [
          PAYMENT_ADVISORY_LOCK_NAMESPACE,
          credito_id,
        ]);
      } catch (unlockError) {
        console.error("⚠️ Error liberando advisory lock:", unlockError);
      }
    }
    lockConn.release();
  }
}
