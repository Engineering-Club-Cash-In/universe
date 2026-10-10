import { describe, expect, it, mock } from "bun:test";
import { convenios_pago, creditos, pagos_credito, rubros } from "../database/db";

// COBROS-02 W4: borrar un crédito para reconstruirlo desde el JSON hace varios DELETE autocommit
// sueltos (boletas, pagos de inversionistas, pagos…). Si hay un convenio vivo sostenido por un
// abono inicial, el trigger de `pagos_credito` frenaría recién el de los pagos y el crédito
// quedaría sin sus boletas. Por eso se comprueba ANTES de borrar nada.

const NOMBRES = new Map<unknown, string>([
  [creditos, "creditos"],
  [rubros, "rubros"],
  [convenios_pago, "convenios_pago"],
  [pagos_credito, "pagos_credito"],
]);
let eventos: string[] = [];
let filas = new Map<unknown, unknown[]>();

const cadena = (verbo: string, tablaInicial?: unknown) => {
  const paso = { tabla: tablaInicial as unknown };
  const eslabon: any = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "then") {
        return (ok: any, err: any) => {
          eventos.push(`${verbo}:${NOMBRES.get(paso.tabla) ?? "otra"}`);
          return Promise.resolve(verbo === "select" ? (filas.get(paso.tabla) ?? []) : []).then(ok, err);
        };
      }
      return (...args: any[]) => {
        if (prop === "from") paso.tabla = args[0];
        return eslabon;
      };
    },
  });
  return eslabon;
};
const motor: any = {
  select: () => cadena("select"),
  insert: (t: unknown) => cadena("insert", t),
  update: (t: unknown) => cadena("update", t),
  delete: (t: unknown) => cadena("delete", t),
};
motor.transaction = (cb: any) => cb(motor);
const fakeDb = () => ({ db: motor, client: {}, lockPool: { connect: async () => ({ query: async () => {}, release: () => {} }) } });
mock.module("../database", fakeDb);
mock.module("../database/index", fakeDb);
mock.module("../utils/paymentAdvisoryLock", () => ({
  PAYMENT_ADVISORY_LOCK_NAMESPACE: 8765,
  holdsPaymentAdvisoryLock: () => false,
  withPaymentAdvisoryLock: async (_c: number, fn: () => Promise<any>) => fn(),
}));

const { eliminarCreditos } = await import("./recalculateFromJson");

const eliminar = () => eliminarCreditos([{ numeroCredito: "0101" } as any], { emitTerminal: false });

describe("eliminarCreditos — abono inicial de un convenio vivo (COBROS-02 W4)", () => {
  it("no borra nada y nombra el convenio", async () => {
    eventos = [];
    filas = new Map<unknown, unknown[]>([
      [creditos, [{ credito_id: 9 }]],
      [rubros, []],
      [convenios_pago, [{ convenio_id: 7 }]],
      [pagos_credito, [{ pago_id: 30 }]],
    ]);

    const r = await eliminar();

    expect(r.detalles[0]!.status).toBe("error");
    expect(r.detalles[0]!.message).toContain("convenio #7");
    expect(eventos.some((e) => e.startsWith("delete:"))).toBe(false);
  });

  it("sin convenio con abono sigue borrando como antes", async () => {
    eventos = [];
    filas = new Map<unknown, unknown[]>([
      [creditos, [{ credito_id: 9 }]],
      [rubros, []],
      [convenios_pago, []],
      [pagos_credito, [{ pago_id: 30 }]],
    ]);

    const r = await eliminar();

    expect(r.detalles[0]!.status).toBe("success");
    expect(eventos).toContain("delete:pagos_credito");
  });
});
