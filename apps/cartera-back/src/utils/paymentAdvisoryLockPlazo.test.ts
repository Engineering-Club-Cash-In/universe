import { describe, expect, it } from "bun:test";

import {
  conectarAntesDe,
  PaymentAdvisoryLockTimeoutError,
} from "./paymentAdvisoryLockPlazo";

describe("conectarAntesDe", () => {
  it("devuelve la conexión si el pool responde a tiempo", async () => {
    const conexion = { query: async () => undefined, release: () => undefined };
    const r = await conectarAntesDe(async () => conexion, 1, Date.now() + 500, 500);
    expect(r).toBe(conexion);
  });

  it("vence si el pool está saturado y devuelve la conexión tardía", async () => {
    let liberada = false;
    let entregar: (c: unknown) => void = () => undefined;
    const pool = () =>
      new Promise<never>((resolve) => {
        entregar = resolve as (c: unknown) => void;
      });
    const espera = conectarAntesDe(pool as never, 7, Date.now() + 30, 30);
    await expect(espera).rejects.toBeInstanceOf(PaymentAdvisoryLockTimeoutError);
    entregar({ query: async () => undefined, release: () => (liberada = true) });
    await new Promise((r) => setTimeout(r, 10));
    expect(liberada).toBeTrue();
  });
});
