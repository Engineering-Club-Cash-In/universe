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
/**
 * Variante acquire/release de `withPaymentAdvisoryLock`, para handlers que no
 * pueden envolver su cuerpo en un callback sin re-indentar cientos de líneas
 * (p. ej. /facturar-pago-completo). MISMO namespace y misma disciplina del
 * lockPool dedicado. El release devuelto es idempotente y SIEMPRE debe
 * llamarse en un finally.
 */
export async function adquirirPaymentAdvisoryLock(
  credito_id: number
): Promise<() => Promise<void>> {
  const lockConn: PaymentAdvisoryLockConnection = await lockPool.connect();
  try {
    await lockConn.query("SELECT pg_advisory_lock($1, $2)", [
      PAYMENT_ADVISORY_LOCK_NAMESPACE,
      credito_id,
    ]);
  } catch (error) {
    lockConn.release();
    throw error;
  }
  let liberado = false;
  return async () => {
    if (liberado) return;
    liberado = true;
    try {
      await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [
        PAYMENT_ADVISORY_LOCK_NAMESPACE,
        credito_id,
      ]);
    } catch (unlockError) {
      console.error("⚠️ Error liberando advisory lock:", unlockError);
    }
    lockConn.release();
  };
}

/**
 * Toma el lock de VARIOS créditos con UNA sola conexión del lockPool, en orden
 * ascendente (dos corridas concurrentes que compartan créditos siempre los
 * piden en el mismo orden → sin deadlock). Para flujos batch como
 * /actualizar-pagos-excel, donde una conexión por crédito agotaría el pool.
 * El release (idempotente, SIEMPRE en un finally) libera en orden inverso.
 */
export async function adquirirPaymentAdvisoryLocks(
  creditoIds: number[]
): Promise<() => Promise<void>> {
  const ids = [...new Set(creditoIds)].sort((a, b) => a - b);
  const lockConn: PaymentAdvisoryLockConnection = await lockPool.connect();
  const tomados: number[] = [];
  const soltarTodos = async () => {
    for (const id of [...tomados].reverse()) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [
          PAYMENT_ADVISORY_LOCK_NAMESPACE,
          id,
        ]);
      } catch (unlockError) {
        console.error("⚠️ Error liberando advisory lock:", unlockError);
      }
    }
    lockConn.release();
  };
  try {
    for (const id of ids) {
      await lockConn.query("SELECT pg_advisory_lock($1, $2)", [
        PAYMENT_ADVISORY_LOCK_NAMESPACE,
        id,
      ]);
      tomados.push(id);
    }
  } catch (error) {
    await soltarTodos();
    throw error;
  }
  let liberado = false;
  return async () => {
    if (liberado) return;
    liberado = true;
    await soltarTodos();
  };
}

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
