import { lockPool } from "../database";

export const PAYMENT_ADVISORY_LOCK_NAMESPACE = 8765;

export type PaymentAdvisoryLockConnection = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

declare const paymentLockBrand: unique symbol;
export type PaymentAdvisoryLock = { readonly [paymentLockBrand]: true };
const heldPaymentLocks = new WeakMap<PaymentAdvisoryLock, {
  creditoId: number;
  connection: PaymentAdvisoryLockConnection;
}>();

export const holdsPaymentAdvisoryLock = (
  lock: PaymentAdvisoryLock | undefined,
  creditoId: number,
) => heldPaymentLocks.get(lock as PaymentAdvisoryLock)?.creditoId === creditoId;

export async function withPaymentBindingLock<T>(
  lock: PaymentAdvisoryLock,
  creditoId: number,
  work: (bindingExists: boolean) => Promise<T>,
): Promise<T> {
  const held = heldPaymentLocks.get(lock);
  if (!held || held.creditoId !== creditoId) {
    throw new Error("Canonical payment lock is not held for this credit");
  }

  await held.connection.query("BEGIN");
  try {
    await held.connection.query(
      "SELECT credito_id FROM cartera.creditos WHERE credito_id = $1 FOR KEY SHARE",
      [creditoId],
    );
    const binding = await held.connection.query(
      "SELECT credito_id FROM cartera.nexa_credit_bindings WHERE credito_id = $1 FOR UPDATE",
      [creditoId],
    ) as { rows?: unknown[] };
    const result = await work((binding.rows?.length ?? 0) > 0);
    await held.connection.query("COMMIT");
    return result;
  } catch (error) {
    await held.connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

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
  fn: (lock: PaymentAdvisoryLock) => Promise<T>
): Promise<T> {
  const lockConn: PaymentAdvisoryLockConnection = await lockPool.connect();
  const lock = {} as PaymentAdvisoryLock;
  try {
    await lockConn.query("SELECT pg_advisory_lock($1, $2)", [
      PAYMENT_ADVISORY_LOCK_NAMESPACE,
      credito_id,
    ]);
    heldPaymentLocks.set(lock, { creditoId: credito_id, connection: lockConn });
    return await fn(lock);
  } finally {
    heldPaymentLocks.delete(lock);
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
