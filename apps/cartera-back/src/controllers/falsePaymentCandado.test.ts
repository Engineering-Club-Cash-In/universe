import { describe, expect, it, mock } from "bun:test";
import { pagos_credito } from "../database/db";

// ─────────────────────────────────────────────────────────────────────────────
// `falsePayment` — QUÉ queda bajo el advisory lock del crédito.
//
// El candado arrancaba recién en la transacción del final, y eso dejaba fuera la
// lectura de `yaFalso` y la escritura del espejo. La carrera no necesita ningún
// error de base ni que nadie reintente: DOS clics en "declarar falsa" sobre el
// mismo pago pasan los dos el `if (yaFalso.paymentFalse)` —es una lectura
// plana— y los dos llegan a `insertPagosCreditoInversionistas`, que es un INSERT
// pelado sin `ON CONFLICT` sobre una tabla SIN restricción única. La
// distribución del espejo queda DUPLICADA y commiteada, y recién después uno de
// los dos pierde el UPDATE y se va con un 400.
//
// `withPendingReturnCreditLocks` no sirve para esto y su propio comentario lo
// dice: es un `FOR NO KEY UPDATE` sobre `creditos` que commitea y suelta antes
// de volver.
//
// Por eso el test mide un ORDEN: el defecto no cambia ningún valor de retorno,
// sólo cambia qué está protegido.
// ─────────────────────────────────────────────────────────────────────────────

let eventos: string[] = [];

const cadena = (verbo: string) => {
  const paso: { tabla: unknown } = { tabla: undefined };
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) => {
            const nombre = paso.tabla === pagos_credito ? "pagos_credito" : "?";
            eventos.push(`${verbo}:${nombre}`);
            // Una fila que NO está marcada falsa: el flujo sigue de largo.
            return Promise.resolve([{ paymentFalse: false }]).then(ok, err);
          };
        }
        return (...args: any[]) => {
          if (prop === "from") paso.tabla = args[0];
          return eslabon;
        };
      },
    }
  );
  return eslabon;
};

const motor: any = {
  select: () => cadena("select"),
  insert: () => cadena("insert"),
  update: () => cadena("update"),
  delete: () => cadena("delete"),
  execute: () => Promise.reject(new Error("sin BD en tests")),
};
motor.transaction = async (cb: any) => {
  eventos.push("tx:begin");
  try {
    return await cb(motor);
  } finally {
    eventos.push("tx:end");
  }
};

mock.module("../database", () => ({
  db: motor,
  client: {},
  lockPool: { connect: async () => ({ query: async () => {}, release: () => {} }) },
}));

mock.module("../utils/paymentAdvisoryLock", () => ({
  PAYMENT_ADVISORY_LOCK_NAMESPACE: 8765,
  withPaymentAdvisoryLock: async (clave: number, fn: () => Promise<any>) => {
    eventos.push(`lock:${clave}`);
    try {
      return await fn();
    } finally {
      eventos.push("unlock");
    }
  },
}));

const { falsePayment } = await import("./payments");

describe("falsePayment — qué protege el candado", () => {
  it("🔒 la lectura de `yaFalso` ocurre YA bajo el candado", async () => {
    // Es el corazón de la carrera de los dos clics: si esa lectura queda fuera,
    // las dos llamadas la pasan y las dos escriben el espejo.
    eventos = [];

    await falsePayment(1, 9).catch(() => {});

    const lock = eventos.indexOf("lock:9");
    const lectura = eventos.indexOf("select:pagos_credito");

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lectura).toBeGreaterThan(lock);
  });

  it("🔒 y el candado sigue tomado cuando abre la transacción", async () => {
    // El orden del módulo: advisory AFUERA, transacción adentro. Invertirlo es
    // el deadlock de pool que prohíbe el helper.
    eventos = [];

    await falsePayment(1, 9).catch(() => {});

    const lock = eventos.indexOf("lock:9");
    const unlock = eventos.indexOf("unlock");
    const tx = eventos.indexOf("tx:begin");

    if (tx >= 0) {
      expect(tx).toBeGreaterThan(lock);
      expect(tx).toBeLessThan(unlock);
    }
  });
});
