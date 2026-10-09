/**
 * Plazo del lock por crédito, sin dependencias de base de datos (se prueba aislado).
 */
import type { PaymentAdvisoryLockConnection } from "./paymentAdvisoryLock";

export class PaymentAdvisoryLockTimeoutError extends Error {
  constructor(credito_id: number, esperaMaximaMs: number) {
    super(`No se obtuvo el lock del crédito ${credito_id} en ${esperaMaximaMs} ms`);
    this.name = "PaymentAdvisoryLockTimeoutError";
  }
}


/**
 * `lockPool.connect()` con plazo. Si vence, la conexión que el pool entregue
 * después se devuelve sola: nadie la va a usar.
 */
export async function conectarAntesDe(
  conectar: () => Promise<PaymentAdvisoryLockConnection>,
  credito_id: number,
  limite: number,
  esperaMaximaMs: number,
): Promise<PaymentAdvisoryLockConnection> {
  const conexion = conectar();
  let vencio = false;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      vencio = true;
      rechazar(new PaymentAdvisoryLockTimeoutError(credito_id, esperaMaximaMs));
    }, Math.max(0, limite - Date.now()));
  });
  try {
    return await Promise.race([conexion, plazo]);
  } catch (error) {
    if (vencio) {
      conexion.then((c) => c.release()).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(temporizador);
  }
}


/**
 * Toma el advisory lock sondeando con `pg_try_advisory_lock` hasta `limite`.
 *
 * El plazo se revisa también DESPUÉS de un intento exitoso: si la conexión, la
 * pausa o la query tardaron y el lock se obtuvo vencido el plazo, se suelta ahí
 * mismo y se lanza el timeout. Un lock aceptado tarde dejaría correr la
 * operación cuando el cliente ya dio la llamada por perdida.
 *
 * Devuelve solo si el lock quedó tomado dentro del plazo (el llamador lo suelta).
 */
export async function sondearLockAntesDe(
  lockConn: PaymentAdvisoryLockConnection,
  namespace: number,
  credito_id: number,
  limite: number,
  esperaMaximaMs: number,
  pausaMs: number,
): Promise<void> {
  for (;;) {
    const res = (await lockConn.query(
      "SELECT pg_try_advisory_lock($1, $2) AS tomado",
      [namespace, credito_id],
    )) as { rows?: { tomado?: boolean }[] };
    const tomado = Boolean(res?.rows?.[0]?.tomado);
    const vencido = Date.now() >= limite;
    if (tomado && !vencido) return;
    if (tomado) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [
          namespace,
          credito_id,
        ]);
      } catch (unlockError) {
        console.error("⚠️ Error liberando advisory lock vencido:", unlockError);
      }
    }
    if (vencido) {
      throw new PaymentAdvisoryLockTimeoutError(credito_id, esperaMaximaMs);
    }
    await new Promise((r) => setTimeout(r, pausaMs));
  }
}
