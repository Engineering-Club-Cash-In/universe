import { lockPool } from "../database";

export const PAYMENT_ADVISORY_LOCK_NAMESPACE = 8765;

export type PaymentAdvisoryLockConnection = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: (destroy?: boolean | Error) => void;
};

type LockPoolLike = { connect: () => Promise<PaymentAdvisoryLockConnection> };

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
  fn: (lock: PaymentAdvisoryLock) => Promise<T>,
  pool: LockPoolLike = lockPool, // inyectable solo para pruebas
): Promise<T> {
  const lockConn: PaymentAdvisoryLockConnection = await pool.connect();
  const lock = {} as PaymentAdvisoryLock;
  // Si el unlock falla, la sesión conserva el lock: la conexión se destruye en vez de volver al pool.
  let destruir = false;
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
      destruir = true;
      console.error("⚠️ Error liberando advisory lock:", unlockError);
    }
    if (destruir) lockConn.release(true); else lockConn.release();
  }
}

/**
 * Hermano NO bloqueante de `withPaymentAdvisoryLock` (`pg_try_advisory_lock`, misma conexión de `lockPool`, misma
 * marca de lock tomado). Si el lock está ocupado devuelve `{ adquirido: false }` SIN ejecutar `fn` y suelta la
 * conexión de inmediato: para jobs que no deben esperar a un pago colgado. Libera siempre, aunque `fn` lance.
 */
export async function tryWithPaymentAdvisoryLock<T>(
  credito_id: number,
  fn: (lock: PaymentAdvisoryLock) => Promise<T>,
  pool: LockPoolLike = lockPool, // inyectable solo para pruebas
): Promise<{ adquirido: true; valor: T } | { adquirido: false }> {
  const lockConn: PaymentAdvisoryLockConnection = await pool.connect();
  const lock = {} as PaymentAdvisoryLock;
  let tomado = false;
  let destruir = false;
  try {
    const r = await lockConn.query("SELECT pg_try_advisory_lock($1, $2) AS ok", [
      PAYMENT_ADVISORY_LOCK_NAMESPACE,
      credito_id,
    ]) as { rows?: { ok?: boolean }[] };
    tomado = r.rows?.[0]?.ok === true;
    if (!tomado) return { adquirido: false };
    heldPaymentLocks.set(lock, { creditoId: credito_id, connection: lockConn });
    return { adquirido: true, valor: await fn(lock) };
  } finally {
    heldPaymentLocks.delete(lock);
    if (tomado) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [PAYMENT_ADVISORY_LOCK_NAMESPACE, credito_id]);
      } catch (unlockError) {
        destruir = true;
        console.error("⚠️ Error liberando advisory lock:", unlockError);
      }
    }
    if (destruir) lockConn.release(true); else lockConn.release();
  }
}
