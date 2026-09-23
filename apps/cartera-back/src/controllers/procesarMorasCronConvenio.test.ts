/**
 * El cron no puede deshacer lo que un convenio acaba de hacer.
 *
 * `procesarMoras` lee la foto de la cartera al arrancar (cuotas, estados de
 * crédito y moras activas) y escribe al final del recorrido. Si un convenio se
 * confirma en el medio, esa foto miente en dos lugares:
 *
 *  - RECALCULO: la fila de mora que el convenio apagó sigue existiendo con
 *    `activa=false` (antes el convenio la BORRABA y el update no la encontraba;
 *    ahora sobrevive para dejar rastro). Un update por `mora_id` la REVIVE con
 *    el monto recalculado y anota un RECALCULO después del DESACTIVACION.
 *  - CREACION: si el crédito no tenía mora previa, el cron le INSERTA una mora
 *    nueva a un crédito ya EN_CONVENIO. El índice único parcial no lo frena:
 *    justamente no hay mora activa que chocar.
 *
 * Y en los dos casos el update de `statusCredit` sacaba el crédito de
 * EN_CONVENIO de vuelta a MOROSO (ese clobber ya existía, no lo introdujo esta
 * rama).
 *
 * Estas pruebas ejercen `procesarMoras` DE VERDAD contra una base falsa y miran
 * qué writes salen, cuáles NO, y qué dicen los contadores.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Call = { tabla: any; set?: any; values?: any; where?: any };

const estado: {
  resultados: any[];
  inserts: Call[];
  updates: Call[];
  /** Filas que devuelve el `.returning()` de un update, por tabla y en orden. */
  updateReturns: Map<any, any[][]>;
  insertThrows: any;
  emitidos: any[];
} = {
  resultados: [],
  inserts: [],
  updates: [],
  updateReturns: new Map(),
  insertThrows: undefined,
  emitidos: [],
};

/**
 * ¿La condición `where` de drizzle menciona esta columna? Recorre los
 * `queryChunks` comparando IDENTIDAD de columna, no strings de SQL.
 */
const mencionaColumna = (nodo: any, columna: unknown): boolean => {
  if (!nodo) return false;
  if (nodo === columna) return true;
  const chunks = Array.isArray(nodo) ? nodo : nodo.queryChunks;
  if (!Array.isArray(chunks)) return false;
  return chunks.some((c) => mencionaColumna(c, columna));
};

/** Valores literales (params) que lleva adentro una condición de drizzle. */
const valoresDe = (nodo: any, acc: any[] = []): any[] => {
  if (!nodo || typeof nodo !== "object") return acc;
  if ("value" in nodo && !("queryChunks" in nodo)) acc.push((nodo as any).value);
  const chunks = Array.isArray(nodo) ? nodo : (nodo as any).queryChunks;
  if (Array.isArray(chunks)) for (const c of chunks) valoresDe(c, acc);
  return acc;
};

const selectChain = () => {
  const b: any = {
    from: () => b,
    innerJoin: () => b,
    leftJoin: () => b,
    where: () => b,
    then: (res: any, rej: any) =>
      Promise.resolve(estado.resultados.shift() ?? []).then(res, rej),
  };
  return b;
};

const dbFalsa = {
  select: () => selectChain(),
  insert: (tabla: any) => ({
    values: (values: any) => {
      estado.inserts.push({ tabla, values });
      const b: any = {
        returning: () => {
          if (estado.insertThrows && tabla === moras_credito) {
            return Promise.reject(estado.insertThrows);
          }
          return Promise.resolve([{ mora_id: 999, porcentaje_mora: "1.12" }]);
        },
        then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
      };
      return b;
    },
  }),
  update: (tabla: any) => ({
    set: (set: any) => {
      const call: Call = { tabla, set };
      estado.updates.push(call);
      const b: any = {
        where: (w: any) => {
          call.where = w;
          return b;
        },
        // Por defecto el update SÍ afecta la fila (nadie compitió).
        returning: () =>
          Promise.resolve(
            estado.updateReturns.get(tabla)?.shift() ?? [{ mora_id: 77, credito_id: 4242 }],
          ),
        then: (res: any, rej: any) => Promise.resolve({ rowCount: 1 }).then(res, rej),
      };
      return b;
    },
  }),
  // La CREACION corre dentro de una transacción (status + mora + historial
  // juntos) con un savepoint alrededor del insert. Este fake NO modela
  // commit/rollback — de eso se encarga procesarMorasCronCreacionAtomica.test.ts;
  // acá solo interesa QUÉ writes se emiten, así que la tx es transparente.
  transaction: async (cb: any) => cb(dbFalsa),
};

const clientFalso = {
  connect: async () => ({
    query: async () => ({ rows: [{ ok: true }] }),
    release: () => {},
  }),
};

mock.module("../database", () => ({ db: dbFalsa, client: clientFalso }));
mock.module("../utils/structuredLogger", () => ({
  emitCreditLateFee: (p: any) => estado.emitidos.push(p),
}));

const { procesarMoras, hoyGuatemala, STATUS_EXCLUIDOS_MORA } = await import("./latefee");
const { creditos, moras_credito, moras_historial } = await import("../database/db/schema");

const CREDITO_ID = 4242;

/** Mora activa con un monto que NO coincide con el recalculado → RECALCULO. */
const MORA_ACTIVA = {
  mora_id: 77,
  credito_id: CREDITO_ID,
  monto_mora: "1.00",
  cuotas_atrasadas: 9,
  porcentaje_mora: "1.12",
};

/** Una cuota vencida AYER con capital suficiente para que la mora sea > Q0.00. */
const cuotaDeAyer = () => {
  const hoy = hoyGuatemala();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  return {
    cuota_id: 1,
    credito_id: CREDITO_ID,
    fecha_vencimiento: ayer,
    pagado: false,
    // La foto del paso 1: cuando el cron arrancó el crédito era elegible.
    statusCredit: "ACTIVO",
    capital: "10000",
    hasPaidPayment: false,
  };
};

const reset = () => {
  estado.resultados = [];
  estado.inserts = [];
  estado.updates = [];
  estado.updateReturns = new Map();
  estado.insertThrows = undefined;
  estado.emitidos = [];
};

const correr = async (opts: {
  moraPrevia: boolean;
  filasMora?: any[][];
  filasCredito?: any[][];
}) => {
  reset();
  estado.resultados = [[cuotaDeAyer()], opts.moraPrevia ? [MORA_ACTIVA] : []];
  if (opts.filasMora) estado.updateReturns.set(moras_credito, opts.filasMora);
  if (opts.filasCredito) estado.updateReturns.set(creditos, opts.filasCredito);
  return (await procesarMoras()) as any;
};

const updatesDeMora = () => estado.updates.filter((c) => c.tabla === moras_credito);
const updatesDeCredito = () => estado.updates.filter((c) => c.tabla === creditos);
const insertsDeMora = () => estado.inserts.filter((c) => c.tabla === moras_credito);
const historial = () => estado.inserts.filter((c) => c.tabla === moras_historial);
const skippedCount = () =>
  estado.emitidos.find((e) => e.operation === "process" && e.outcome === "completed")?.skippedCount;
const succeededCount = () =>
  estado.emitidos.find((e) => e.operation === "process" && e.outcome === "completed")?.succeededCount;

beforeEach(reset);

describe("procesarMoras — el convenio se confirma a media corrida", () => {
  // ── Rama RECALCULO ──────────────────────────────────────────────────────
  it("RECALCULO normal: recalcula, marca MOROSO, anota el historial y cuenta", async () => {
    const r = await correr({ moraPrevia: true });

    expect(updatesDeMora().length).toBe(1);
    expect(updatesDeMora()[0].set).toMatchObject({ cuotas_atrasadas: 1 });
    expect(updatesDeCredito().length).toBe(1);
    expect(updatesDeCredito()[0].set).toEqual({ statusCredit: "MOROSO" });
    expect(historial().length).toBe(1);
    expect(historial()[0].values).toMatchObject({
      tipo_evento: "RECALCULO",
      monto_anterior: "1.00",
    });
    expect(r.recalculadas).toBe(1);
    expect(skippedCount()).toBe(0);
    expect(succeededCount()).toBe(1);
  });

  it("el UPDATE del RECALCULO filtra por activa=true, no solo por mora_id", async () => {
    await correr({ moraPrevia: true });

    const upd = updatesDeMora()[0];
    expect(upd).toBeDefined();
    // Sin este filtro el update REVIVE la mora que el convenio acababa de apagar.
    expect(mencionaColumna(upd.where, moras_credito.activa)).toBe(true);
    expect(mencionaColumna(upd.where, moras_credito.mora_id)).toBe(true);
  });

  it("RECALCULO con 0 filas (el convenio ya la apagó): no escribe historial, no toca el status y no cuenta", async () => {
    const r = await correr({ moraPrevia: true, filasMora: [[]] });

    expect(historial()).toEqual([]);
    expect(updatesDeCredito()).toEqual([]);
    expect(r.recalculadas).toBe(0);
    expect(succeededCount()).toBe(0);
    // No se pierde de la cuenta: cae en los omitidos por concurrencia.
    expect(skippedCount()).toBe(1);
  });

  it("el UPDATE de status del RECALCULO no puede pisar un estado excluido", async () => {
    await correr({ moraPrevia: true });

    const upd = updatesDeCredito()[0];
    expect(upd).toBeDefined();
    expect(mencionaColumna(upd.where, creditos.statusCredit)).toBe(true);
    const valores = valoresDe(upd.where);
    // EN_CONVENIO, INCOBRABLE, CANCELADO, PENDIENTE_CANCELACION, CAIDO.
    for (const excluido of STATUS_EXCLUIDOS_MORA) {
      expect(valores).toContain(excluido);
    }
  });

  // ── Rama CREACION ───────────────────────────────────────────────────────
  it("CREACION normal: marca MOROSO, inserta la mora, anota el historial y cuenta", async () => {
    const r = await correr({ moraPrevia: false });

    expect(updatesDeCredito().length).toBe(1);
    expect(updatesDeCredito()[0].set).toEqual({ statusCredit: "MOROSO" });
    expect(insertsDeMora().length).toBe(1);
    expect(insertsDeMora()[0].values).toMatchObject({ credito_id: CREDITO_ID, activa: true });
    expect(historial().length).toBe(1);
    expect(historial()[0].values).toMatchObject({ tipo_evento: "CREACION" });
    expect(r.creadas).toBe(1);
    expect(skippedCount()).toBe(0);
    expect(succeededCount()).toBe(1);
  });

  it("el UPDATE de status de la CREACION no puede pisar un estado excluido", async () => {
    await correr({ moraPrevia: false });

    const upd = updatesDeCredito()[0];
    expect(upd).toBeDefined();
    expect(mencionaColumna(upd.where, creditos.statusCredit)).toBe(true);
    const valores = valoresDe(upd.where);
    for (const excluido of STATUS_EXCLUIDOS_MORA) {
      expect(valores).toContain(excluido);
    }
  });

  it("CREACION sobre un crédito ya EN_CONVENIO (0 filas): no inserta mora, no anota historial y no cuenta", async () => {
    const r = await correr({ moraPrevia: false, filasCredito: [[]] });

    expect(insertsDeMora()).toEqual([]);
    expect(historial()).toEqual([]);
    expect(r.creadas).toBe(0);
    expect(succeededCount()).toBe(0);
    expect(skippedCount()).toBe(1);
  });

  it("CREACION que choca con el índice único (23505): no anota historial y no cuenta", async () => {
    estado.insertThrows = Object.assign(new Error("dup"), { code: "23505" });
    estado.resultados = [[cuotaDeAyer()], []];
    const r = (await procesarMoras()) as any;

    expect(historial()).toEqual([]);
    expect(r.creadas).toBe(0);
    expect(skippedCount()).toBe(1);
  });
});
