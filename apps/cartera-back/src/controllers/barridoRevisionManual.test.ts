import "../utils/baseFalsaParaPruebas";
import { expect, test } from "bun:test";
import { barrerCondonacionesBoletaTardiaHuerfanas, debeFallarElBarrido, type DepsBarrido } from "./barridoCondonacionesBoletaTardia";

const deps = (candidatas: { condonacion_id: number; credito_id: number; intento_id: string; primera_vez?: boolean }[]): DepsBarrido => ({
  candidatas: async () => candidatas,
  abandonadas: async () => [],
  sinFilasVivas: async () => true,
  filasSinMarca: async () => true, // todas caen en revisión manual
  conLock: (async (_id: number, fn: () => Promise<unknown>) => ({ adquirido: true, valor: await fn() })) as never,
  anular: (async () => { throw new Error("no debía anular"); }) as never,
});
const callado = async <T>(f: () => Promise<T>) => {
  const w = console.warn; console.warn = () => {};
  try { return await f(); } finally { console.warn = w; }
};

test("revisión manual REPETIDA (no es la primera franja) se cuenta aparte y NO hace fallar el job", async () => {
  const r = await callado(() => barrerCondonacionesBoletaTardiaHuerfanas(deps([
    { condonacion_id: 1, credito_id: 1, intento_id: "a", primera_vez: false },
  ])));
  expect(r).toMatchObject({ revision_manual: 1, revision_manual_nueva: 0, revision_manual_repetida: 1 });
  expect(debeFallarElBarrido(r)).toBe(false);
});

test("revisión manual NUEVA (primera vez que el barrido la ve) sí hace fallar el job, una sola vez", async () => {
  const r = await callado(() => barrerCondonacionesBoletaTardiaHuerfanas(deps([
    { condonacion_id: 2, credito_id: 2, intento_id: "b", primera_vez: true },
    { condonacion_id: 3, credito_id: 3, intento_id: "c", primera_vez: false },
  ])));
  expect(r).toMatchObject({ revision_manual: 2, revision_manual_nueva: 1, revision_manual_repetida: 1 });
  expect(debeFallarElBarrido(r)).toBe(true);
});

test("fallidas y abandonadas nuevas siguen haciendo fallar; un barrido limpio no", () => {
  const base = { fallidas: 0, abandonadas_nuevas: 0, revision_manual_nueva: 0 };
  expect(debeFallarElBarrido(base)).toBe(false);
  expect(debeFallarElBarrido({ ...base, fallidas: 1 })).toBe(true);
  expect(debeFallarElBarrido({ ...base, abandonadas_nuevas: 1 })).toBe(true);
});
