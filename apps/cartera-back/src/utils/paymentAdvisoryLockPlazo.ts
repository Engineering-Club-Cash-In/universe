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

