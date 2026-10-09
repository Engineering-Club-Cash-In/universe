import { describe, expect, it } from "bun:test";

import {
  conectarAntesDe,
  sondearLockAntesDe,
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

describe("sondearLockAntesDe", () => {
  const conexion = (respuestas: boolean[], consultas: string[], demoraMs = 0) => ({
    query: async (texto: string) => {
      consultas.push(texto);
      if (!texto.includes("pg_try_advisory_lock")) return { rows: [] };
      if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs));
      return { rows: [{ tomado: respuestas.shift() ?? false }] };
    },
    release: () => undefined,
  });

  it("devuelve si toma el lock dentro del plazo", async () => {
    const consultas: string[] = [];
    await sondearLockAntesDe(conexion([true], consultas), 1, 5, Date.now() + 500, 500, 5);
    expect(consultas.some((q) => q.includes("unlock"))).toBeFalse();
  });

  it("reintenta hasta tomarlo", async () => {
    const consultas: string[] = [];
    await sondearLockAntesDe(
      conexion([false, false, true], consultas),
      1,
      5,
      Date.now() + 500,
      500,
      5,
    );
    expect(consultas.filter((q) => q.includes("pg_try")).length).toBe(3);
  });

  it("si lo toma vencido el plazo, lo suelta y lanza", async () => {
    const consultas: string[] = [];
    // La query tarda más que el plazo: responde "tomado" cuando ya venció.
    const espera = sondearLockAntesDe(
      conexion([true], consultas, 40),
      1,
      5,
      Date.now() + 10,
      10,
      5,
    );
    await expect(espera).rejects.toBeInstanceOf(PaymentAdvisoryLockTimeoutError);
    expect(consultas.some((q) => q.includes("pg_advisory_unlock"))).toBeTrue();
  });

  it("sin lock y vencido el plazo, lanza sin soltar nada", async () => {
    const consultas: string[] = [];
    const espera = sondearLockAntesDe(
      conexion([false, false, false, false, false, false], consultas),
      1,
      5,
      Date.now() + 15,
      15,
      5,
    );
    await expect(espera).rejects.toBeInstanceOf(PaymentAdvisoryLockTimeoutError);
    expect(consultas.some((q) => q.includes("unlock"))).toBeFalse();
  });
});
