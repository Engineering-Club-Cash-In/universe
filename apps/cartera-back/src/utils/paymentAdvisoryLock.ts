import { AsyncLocalStorage } from "node:async_hooks";
import { lockPool } from "../database";
import { CARTERA_SCHEMA } from "../database/db/schema";
import {
  conectarAntesDe,
  PaymentAdvisoryLockTimeoutError,
  sondearLockAntesDe,
} from "./paymentAdvisoryLockPlazo";

export { PaymentAdvisoryLockTimeoutError };

export const PAYMENT_ADVISORY_LOCK_NAMESPACE = 8765;

/** Pausa entre intentos de `pg_try_advisory_lock` cuando hay plazo de espera. */
const PAUSA_ENTRE_INTENTOS_MS = 100;

/**
 * Créditos cuyo lock ya sostiene la cadena async actual. Hace el lock
 * REENTRANTE por cadena: `rechazarPagoBoleta` toma el lock y adentro llama a
 * `reversePayment`, que también lo toma — sin esto, la segunda toma usaría
 * otra conexión del lockPool y esperaría para siempre al primero (deadlock).
 * Otra request del mismo proceso tiene su propio contexto, así que sigue
 * bloqueándose como debe.
 *
 * Guarda, por crédito, el handle `PaymentAdvisoryLock` que tomó la cadena: la
 * reentrada le pasa a `fn` ESE mismo handle, así `holdsPaymentAdvisoryLock` /
 * `withPaymentBindingLock` (Nexa) siguen reconociendo el lock sostenido.
 */
const locksDeLaCadena = new AsyncLocalStorage<
  ReadonlyMap<number, PaymentAdvisoryLock>
>();

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
      `SELECT credito_id FROM ${CARTERA_SCHEMA}.creditos WHERE credito_id = $1 FOR KEY SHARE`,
      [creditoId],
    );
    const binding = await held.connection.query(
      `SELECT credito_id FROM ${CARTERA_SCHEMA}.nexa_credit_bindings WHERE credito_id = $1 FOR UPDATE`,
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
  /**
   * `esperaMaximaMs`: sin él se espera sin límite (lo normal). Con él se sondea
   * con `pg_try_advisory_lock` y, vencido el plazo, se lanza
   * `PaymentAdvisoryLockTimeoutError` SIN haber ejecutado `fn`. Es para quien
   * tiene un cliente que da por perdida la llamada: un handler que sigue en la
   * cola del lock no puede confirmar su escritura horas después.
   */
  opciones?: { esperaMaximaMs?: number }
): Promise<T> {
  const yaSostenidos = locksDeLaCadena.getStore();
  const lockHeredado = yaSostenidos?.get(credito_id);
  if (lockHeredado) {
    // Reentrada: esta misma cadena ya tiene el lock del crédito.
    return fn(lockHeredado);
  }
  // El plazo corre desde ACÁ: pedir la conexión al pool dedicado también espera
  // (diez conexiones, sin timeout propio) y cuenta dentro de `esperaMaximaMs`.
  const limite =
    opciones?.esperaMaximaMs === undefined ? null : Date.now() + opciones.esperaMaximaMs;
  const lockConn: PaymentAdvisoryLockConnection =
    limite === null
      ? await lockPool.connect()
      : await conectarAntesDe(
          () => lockPool.connect() as Promise<PaymentAdvisoryLockConnection>,
          credito_id,
          limite,
          opciones?.esperaMaximaMs ?? 0,
        );
  const lock = {} as PaymentAdvisoryLock;
  let tomado = false;
  try {
    if (limite === null) {
      await lockConn.query("SELECT pg_advisory_lock($1, $2)", [
        PAYMENT_ADVISORY_LOCK_NAMESPACE,
        credito_id,
      ]);
    } else {
      await sondearLockAntesDe(
        lockConn,
        PAYMENT_ADVISORY_LOCK_NAMESPACE,
        credito_id,
        limite,
        opciones?.esperaMaximaMs ?? 0,
        PAUSA_ENTRE_INTENTOS_MS,
      );
    }
    tomado = true;
    heldPaymentLocks.set(lock, { creditoId: credito_id, connection: lockConn });
    const sostenidos = new Map(yaSostenidos ?? []);
    sostenidos.set(credito_id, lock);
    return await locksDeLaCadena.run(sostenidos, () => fn(lock));
  } finally {
    heldPaymentLocks.delete(lock);
    if (tomado || limite === null) {
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

/**
 * Corre `fn` con el contexto de locks LIMPIO. Para trabajo fire-and-forget
 * lanzado desde adentro de un lock (p. ej. la facturación post-commit de
 * Págalo): si heredara `locksDeLaCadena`, `withPaymentAdvisoryLock` creería
 * que ya tiene el lock, no lo tomaría, y seguiría corriendo después de que el
 * dueño original lo soltó (hallazgo Codex). Así siempre adquiere el suyo.
 */
export function fueraDeLocksHeredados<T>(fn: () => Promise<T>): Promise<T> {
  return locksDeLaCadena.exit(fn);
}
