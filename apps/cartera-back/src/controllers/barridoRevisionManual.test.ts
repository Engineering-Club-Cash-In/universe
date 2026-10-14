import "../utils/baseFalsaParaPruebas";
import { beforeEach, expect, test } from "bun:test";
import {
  barrerCondonacionesBoletaTardiaHuerfanas, debeFallarElBarrido, olvidarAvisosRevisionManualParaPruebas, type DepsBarrido,
} from "./barridoCondonacionesBoletaTardia";

type C = { condonacion_id: number; credito_id: number; intento_id: string };
const deps = (candidatas: C[], o: Partial<DepsBarrido> = {}): DepsBarrido => ({
  candidatas: async () => candidatas,
  abandonadas: async () => [],
  sinFilasVivas: async () => true,
  filasSinMarca: async () => true, // todas caen en revisión manual
  conLock: (async (_id: number, fn: () => Promise<unknown>) => ({ adquirido: true, valor: await fn() })) as never,
  anular: (async () => { throw new Error("no debía anular"); }) as never,
  ...o,
});
const sinLock = (async () => ({ adquirido: false })) as never;
const callado = async <T>(f: () => Promise<T>) => {
  const w = console.warn; console.warn = () => {};
  try { return await f(); } finally { console.warn = w; }
};
const corrida = (d: DepsBarrido) => callado(() => barrerCondonacionesBoletaTardiaHuerfanas(d));
const c1: C = { condonacion_id: 1, credito_id: 1, intento_id: "a" };

beforeEach(() => olvidarAvisosRevisionManualParaPruebas());

test("la 1ª corrida que la clasifica avisa (nueva, falla el job); la 2ª la cuenta repetida y no falla", async () => {
  const r1 = await corrida(deps([c1]));
  expect(r1).toMatchObject({ revision_manual: 1, revision_manual_nueva: 1, revision_manual_repetida: 0 });
  expect(debeFallarElBarrido(r1)).toBe(true);
  const r2 = await corrida(deps([c1]));
  expect(r2).toMatchObject({ revision_manual: 1, revision_manual_nueva: 0, revision_manual_repetida: 1 });
  expect(debeFallarElBarrido(r2)).toBe(false);
});

test("Codex r1 #12: sin el lock en la 1ª corrida no se clasifica; la siguiente con lock SÍ avisa", async () => {
  const r1 = await corrida(deps([c1], { conLock: sinLock }));
  expect(r1).toMatchObject({ omitidas_por_lock: 1, revision_manual_nueva: 0 });
  const r2 = await corrida(deps([c1]));
  expect(r2).toMatchObject({ revision_manual_nueva: 1 });
  expect(debeFallarElBarrido(r2)).toBe(true);
});

test("Codex r1 #12: una corrida solapada no clasifica; la normal siguiente SÍ avisa", async () => {
  let soltar!: () => void;
  const enEspera = new Promise<void>((r) => { soltar = r; });
  const primera = corrida(deps([], { candidatas: async () => { await enEspera; return []; } }));
  const solapada = await corrida(deps([c1]));
  expect(solapada).toMatchObject({ solapada: true, revision_manual_nueva: 0 });
  soltar();
  await primera;
  expect(await corrida(deps([c1]))).toMatchObject({ revision_manual_nueva: 1 });
});

test("la que deja de ser candidata se olvida: si vuelve, se avisa otra vez", async () => {
  expect(await corrida(deps([c1]))).toMatchObject({ revision_manual_nueva: 1 });
  await corrida(deps([]));
  expect(await corrida(deps([c1]))).toMatchObject({ revision_manual_nueva: 1 });
});

test("dos revisiones manuales: cada una avisa una sola vez", async () => {
  const c2: C = { condonacion_id: 2, credito_id: 2, intento_id: "b" };
  expect(await corrida(deps([c1]))).toMatchObject({ revision_manual_nueva: 1 });
  expect(await corrida(deps([c1, c2]))).toMatchObject({ revision_manual: 2, revision_manual_nueva: 1, revision_manual_repetida: 1 });
});

test("fallidas y abandonadas nuevas siguen haciendo fallar; un barrido limpio no", () => {
  const base = { fallidas: 0, abandonadas_nuevas: 0, revision_manual_nueva: 0 };
  expect(debeFallarElBarrido(base)).toBe(false);
  expect(debeFallarElBarrido({ ...base, fallidas: 1 })).toBe(true);
  expect(debeFallarElBarrido({ ...base, abandonadas_nuevas: 1 })).toBe(true);
});
