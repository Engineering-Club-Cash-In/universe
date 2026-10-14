import "../utils/baseFalsaParaPruebas";
import { expect, test } from "bun:test";
import { barrerCondonacionesBoletaTardiaHuerfanas, type DepsBarrido } from "./barridoCondonacionesBoletaTardia";

// Codex r1 #9: las abandonadas se avisan UNA vez (franja 24 h–24 h+15 min). Si su consulta falla,
// la corrida tiene que contar como fallida para que el job lo reporte, no tragarse el error.
test("si la consulta de abandonadas lanza, la corrida cuenta una fallida", async () => {
  const deps: DepsBarrido = {
    candidatas: async () => [],
    abandonadas: async () => { throw new Error("x"); },
    sinFilasVivas: async () => true,
    filasSinMarca: async () => false,
    conLock: (async () => ({ adquirido: false })) as unknown as DepsBarrido["conLock"],
    anular: (async () => ({ anulada: false })) as unknown as DepsBarrido["anular"],
  };
  const r = await barrerCondonacionesBoletaTardiaHuerfanas(deps);
  expect(r.fallidas).toBe(1);
  expect(r.abandonadas_nuevas).toBe(0);
});
