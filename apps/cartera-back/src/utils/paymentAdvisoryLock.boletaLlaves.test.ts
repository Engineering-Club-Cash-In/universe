import "./baseFalsaParaPruebas";
import { afterEach, beforeEach, expect, test } from "bun:test";

// Instancia propia del módulo real (otros archivos hacen mock.module de paymentAdvisoryLock). El pool se inyecta.
const rutaFresca = "./paymentAdvisoryLock.ts?boletaLlaves";
const { tryWithBoletaLlavesLock, withPaymentAdvisoryLock, BOLETA_LLAVE_ADVISORY_LOCK_NAMESPACE } =
  await import(rutaFresca) as typeof import("./paymentAdvisoryLock");

let consultas: [string, unknown[] | undefined][];
let conexiones: number;
let releases: unknown[][];
let ocupadas: Set<string>;
let fallaUnlock: boolean;
let lanzaTryEn: string | undefined;
let errorLog: typeof console.error;
const pool = {
  connect: async () => {
    conexiones++;
    return {
      query: async (texto: string, valores?: unknown[]) => {
        consultas.push([texto, valores]);
        if (!texto.includes("hashtext")) return { rows: [{ ok: true }] }; // candado del crédito
        if (texto.includes("pg_advisory_unlock") && fallaUnlock) throw new Error("conexión perdida");
        if (texto.includes("pg_try_advisory_lock") && valores?.[1] === lanzaTryEn) throw new Error("se cayó la consulta");
        return { rows: [{ ok: !ocupadas.has(String(valores?.[1])) }] };
      },
      release: (...args: unknown[]) => { releases.push(args); },
    };
  },
};
const deLlaves = (patron: string) => consultas.filter(([t]) => t.includes("hashtext") && t.includes(patron)).map(([, v]) => v?.[1]);
const tomas = () => deLlaves("pg_try_advisory_lock");
const sueltas = () => deLlaves("pg_advisory_unlock");
/** Las llaves se piden DENTRO del candado del crédito, con ese candado. */
const conCredito = <T>(llaves: string[], fn: () => Promise<T>) => withPaymentAdvisoryLock(7, (lock) => tryWithBoletaLlavesLock(lock, llaves, fn), pool);
beforeEach(() => {
  consultas = []; conexiones = 0; releases = []; ocupadas = new Set(); fallaUnlock = false; lanzaTryEn = undefined;
  errorLog = console.error; console.error = () => {};
});
afterEach(() => { console.error = errorLog; });

test("espacio propio 8769 con hashtext, en la MISMA conexión del crédito; ordena y quita repetidas; corre fn y suelta todo", async () => {
  const r = await conCredito(["b.jpg", "a.jpg", "b.jpg"], async () => "ok");
  expect(r).toEqual({ adquirido: true, valor: "ok" });
  expect(BOLETA_LLAVE_ADVISORY_LOCK_NAMESPACE).toBe(8769);
  expect(consultas.find(([t]) => t.includes("pg_try_advisory_lock"))).toEqual(["SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok", [8769, "a.jpg"]]);
  expect(tomas()).toEqual(["a.jpg", "b.jpg"]);
  expect(sueltas().sort()).toEqual(["a.jpg", "b.jpg"]);
  expect(conexiones).toBe(1);
  expect(releases).toEqual([[]]);
});

test("si la segunda llave está ocupada: suelta la primera, no corre fn y dice cuál estaba ocupada", async () => {
  ocupadas.add("b.jpg");
  let corrio = false;
  const r = await conCredito(["a.jpg", "b.jpg"], async () => { corrio = true; });
  expect(r).toEqual({ adquirido: false, llave: "b.jpg" });
  expect(corrio).toBe(false);
  expect(sueltas()).toEqual(["a.jpg"]);
  expect(releases).toEqual([[]]);
});

test("suelta todo aunque fn lance, y relanza el mismo error", async () => {
  await expect(conCredito(["a.jpg", "b.jpg"], async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(sueltas().sort()).toEqual(["a.jpg", "b.jpg"]);
  expect(releases).toEqual([[]]);
});

test("si el try-lock lanza a mitad del ciclo: suelta las ya tomadas, no corre fn y relanza", async () => {
  lanzaTryEn = "b.jpg";
  let corrio = false;
  await expect(conCredito(["a.jpg", "b.jpg", "c.jpg"], async () => { corrio = true; })).rejects.toThrow("se cayó la consulta");
  expect(corrio).toBe(false);
  expect(sueltas()).toEqual(["a.jpg"]);
  expect(releases).toEqual([[]]);
});

test("si un unlock de llave falla, intenta los demás y el dueño del candado del crédito DESTRUYE la conexión", async () => {
  fallaUnlock = true;
  await conCredito(["a.jpg", "b.jpg"], async () => "ok");
  expect(sueltas().sort()).toEqual(["a.jpg", "b.jpg"]);
  expect(releases).toEqual([[true]]);
});

test("sin el candado del crédito en mano no toma nada", async () => {
  await expect(tryWithBoletaLlavesLock({} as never, ["a.jpg"], async () => "ok")).rejects.toThrow(/not held/);
  expect(consultas).toEqual([]);
});
