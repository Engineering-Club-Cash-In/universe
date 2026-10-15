import "./baseFalsaParaPruebas";
import { beforeEach, afterEach, expect, test } from "bun:test";

// Otros archivos de la suite hacen mock.module("../utils/paymentAdvisoryLock") y la mock se filtra entre archivos:
// el especificador con query pide una instancia propia del módulo real. El pool se inyecta (sin tocar `lockPool`).
const rutaFresca = "./paymentAdvisoryLock.ts?unlockFalla";
const { withPaymentAdvisoryLock, tryWithPaymentAdvisoryLock } = await import(rutaFresca) as typeof import("./paymentAdvisoryLock");

let releases: unknown[][];
let consultas: string[];
let fallaUnlock: boolean;
let tomaElLock: boolean;
let errorLog: typeof console.error;
const pool = {
  connect: async () => ({
    query: async (texto: string) => {
      consultas.push(texto);
      if (fallaUnlock && texto.includes("pg_advisory_unlock")) throw new Error("conexión perdida");
      return { rows: [{ ok: tomaElLock }] };
    },
    release: (...args: unknown[]) => { releases.push(args); },
  }),
};
beforeEach(() => { releases = []; consultas = []; fallaUnlock = false; tomaElLock = true; errorLog = console.error; console.error = () => {}; });
afterEach(() => { console.error = errorLog; });

for (const [nombre, correr] of [
  ["withPaymentAdvisoryLock", () => withPaymentAdvisoryLock(5, async () => "ok", pool)],
  ["tryWithPaymentAdvisoryLock", () => tryWithPaymentAdvisoryLock(5, async () => "ok", pool)],
] as const) {
  test(`${nombre}: si el unlock falla, la conexión se DESTRUYE (release(true)) y no vuelve al pool con el lock de sesión`, async () => {
    fallaUnlock = true;
    await correr();
    expect(consultas.some((c) => c.includes("pg_advisory_unlock"))).toBe(true);
    expect(releases).toEqual([[true]]);
  });

  test(`${nombre}: si el unlock sale bien, release() sin destruir (comportamiento idéntico)`, async () => {
    await correr();
    expect(consultas.some((c) => c.includes("pg_advisory_unlock"))).toBe(true);
    expect(releases.map((a) => a.length)).toEqual([0]);
  });
}

test("tryWithPaymentAdvisoryLock: si el lock no se tomó no hay unlock y se libera sin destruir", async () => {
  tomaElLock = false;
  expect(await tryWithPaymentAdvisoryLock(5, async () => "x", pool)).toEqual({ adquirido: false });
  expect(consultas.some((c) => c.includes("pg_advisory_unlock"))).toBe(false);
  expect(releases.map((a) => a.length)).toEqual([0]);
});
