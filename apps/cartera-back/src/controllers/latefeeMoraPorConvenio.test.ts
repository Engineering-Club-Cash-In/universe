import { describe, expect, it, mock, beforeEach } from "bun:test";

// ============================================================================
// Fake db para desactivarMoraPorConvenio
//
// El helper hace (en orden):
//   1. db.select(...).from(moras_credito).where(...)  → la mora activa (0 o 1)
//   2. db.update(moras_credito).set(...).where(...).returning() → apagarla
//   3. db.insert(moras_historial).values(...)         → evento DESACTIVACION
//
// (2) y (3) van dentro de una transacción: la del caller si trae `dbClient`,
// una propia si no. Por eso la base falsa expone `transaction`.
//
// Lo que se prueba es justamente lo que el DELETE duro del convenio NO hacía:
// que quede fila y quede rastro con el monto que se soltó — más que ese rastro
// no se duplique ni se pierda.
// ============================================================================

type Fila = Record<string, unknown>;

const state: {
  selectQueue: Fila[][];
  selectCalls: number;
  /** Un registro por SELECT: si corrió dentro de una tx y si pidió FOR UPDATE. */
  selects: Array<{ enTx: boolean; forUpdate: boolean }>;
  /** true mientras se ejecuta el callback de `transaction`. */
  enTx: boolean;
  updates: Array<{ table: unknown; set: Fila; where: unknown }>;
  /** Filas que devuelve cada .returning() del update, en orden. */
  updateReturnQueue: Fila[][];
  inserts: Array<{ table: unknown; values: Fila }>;
  deletes: number;
  /** Transacciones propias que terminaron en excepción (= rollback). */
  rollbacks: number;
  commits: number;
} = {
  selectQueue: [],
  selectCalls: 0,
  selects: [],
  enTx: false,
  updates: [],
  updateReturnQueue: [],
  inserts: [],
  deletes: 0,
  rollbacks: 0,
  commits: 0,
};

/**
 * ¿La condición `where` de drizzle menciona esta columna? Recorre los
 * `queryChunks` del SQL armado por `and(eq(...), eq(...))`. Sirve para que un
 * test FALLE si alguien le quita el filtro `activa` al update.
 */
const mencionaColumna = (nodo: any, columna: unknown): boolean => {
  if (!nodo) return false;
  if (nodo === columna) return true;
  const chunks = Array.isArray(nodo) ? nodo : nodo.queryChunks;
  if (!Array.isArray(chunks)) return false;
  return chunks.some((c) => mencionaColumna(c, columna));
};

const makeSelectChain = () => {
  const result = state.selectQueue[state.selectCalls] ?? [];
  state.selectCalls++;
  // Se anota DÓNDE se leyó: si fue adentro de la transacción y si pidió el
  // candado de fila. Los montos que se leen son los que se escriben al
  // historial, así que leerlos fuera del candado deja que otra ruta cambie la
  // fila entremedio y el evento audite una cifra que ya no es la que se apagó.
  const registro = { enTx: state.enTx, forUpdate: false };
  state.selects.push(registro);
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => {
      const p: any = Promise.resolve(result);
      p.for = (fuerza: string) => {
        registro.forUpdate = fuerza === "update";
        return p;
      };
      return p;
    },
  };
  return chain;
};

const fakeDb: any = {
  select: () => makeSelectChain(),
  update: (table: unknown) => ({
    set: (setValues: Fila) => ({
      where: (condicion: unknown) => {
        state.updates.push({ table, set: setValues, where: condicion });
        // Por defecto el update SÍ afecta la fila (nadie compitió).
        const filas = state.updateReturnQueue.shift() ?? [{ mora_id: 95201 }];
        return {
          returning: () => Promise.resolve(filas),
        };
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: Fila) => {
      state.inserts.push({ table, values });
      return Promise.resolve([]);
    },
  }),
  delete: () => {
    state.deletes++;
    return { where: () => ({ returning: () => Promise.resolve([]) }) };
  },
  // Transacción propia del helper cuando el caller no trae `dbClient`: si el
  // callback lanza, la base real revierte TODO lo escrito adentro.
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    const anterior = state.enTx;
    state.enTx = true;
    try {
      const r = await cb(fakeDb);
      state.commits++;
      return r;
    } catch (e) {
      state.rollbacks++;
      throw e;
    } finally {
      state.enTx = anterior;
    }
  },
};

// `db` es la base falsa para poder ejercitar también el camino SIN `dbClient`,
// que es el que usa producción (createPaymentAgreement).
mock.module("../database", () => ({ db: fakeDb, client: {} }));

const { desactivarMoraPorConvenio } = await import("./latefee");
const { moras_credito, moras_historial } = await import(
  "../database/db/schema"
);

const MORA_ACTIVA = {
  mora_id: 95201,
  monto_mora: "1286.34",
  cuotas_atrasadas: 3,
  porcentaje_mora: "1.12",
};

beforeEach(() => {
  state.selectQueue = [];
  state.selectCalls = 0;
  state.selects = [];
  state.enTx = false;
  state.updates = [];
  state.updateReturnQueue = [];
  state.inserts = [];
  state.deletes = 0;
  state.rollbacks = 0;
  state.commits = 0;
});

const correr = (opts: Record<string, unknown> = {}) =>
  desactivarMoraPorConvenio(72, { dbClient: fakeDb as any, ...opts });

describe("desactivarMoraPorConvenio", () => {
  it("con mora activa: la apaga en vez de borrarla", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    const res = await correr();

    expect(state.deletes).toBe(0);
    expect(res).toMatchObject({
      desactivada: true,
      mora_id: 95201,
      monto_anterior: "1286.34",
    });

    const upd = state.updates.find((u) => u.table === moras_credito);
    expect(upd).toBeDefined();
    expect(upd!.set.monto_mora).toBe("0");
    expect(upd!.set.cuotas_atrasadas).toBe(0);
    expect(upd!.set.activa).toBe(false);
    expect(upd!.set.updated_at).toBeInstanceOf(Date);
  });

  it("anota el evento en moras_historial con el monto que se soltó", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    await correr({ usuario_id: 41 });

    const hist = state.inserts.find((i) => i.table === moras_historial);
    expect(hist).toBeDefined();
    expect(hist!.values).toMatchObject({
      credito_id: 72,
      mora_id: 95201,
      tipo_evento: "DESACTIVACION",
      origen: "API_MANUAL",
      // El monto anterior es el que hoy se pierde sin rastro: Q1286.34.
      monto_anterior: "1286.34",
      monto_nuevo: "0",
      cuotas_atrasadas_anterior: 3,
      cuotas_atrasadas_nuevas: 0,
      usuario_id: 41,
    });
  });

  it("el motivo dice que fue por convenio de pago", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    await correr({ convenio_id: 102 });

    const hist = state.inserts.find((i) => i.table === moras_historial);
    const motivo = String(hist!.values.motivo);
    expect(motivo).toContain("convenio de pago");
    expect(motivo).toContain("102");
  });

  it("sin convenio_id el motivo igual identifica al convenio de pago", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    await correr();

    const hist = state.inserts.find((i) => i.table === moras_historial);
    expect(String(hist!.values.motivo)).toContain("convenio de pago");
  });

  it("sin mora activa: no escribe nada y lo reporta", async () => {
    state.selectQueue = [[]];

    const res = await correr({ convenio_id: 102 });

    expect(res).toEqual({ desactivada: false });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });

  it("dentro de una transacción el fallo del historial NO se traga", async () => {
    state.selectQueue = [[MORA_ACTIVA]];
    const txFallado = {
      ...fakeDb,
      insert: () => ({
        values: () => Promise.reject(new Error("historial caído simulado")),
      }),
    };

    await expect(
      desactivarMoraPorConvenio(72, { dbClient: txFallado as any })
    ).rejects.toThrow("historial caído simulado");
  });

  // ── Carrera entre dos convenios del mismo crédito ────────────────────────
  it("el update filtra por activa=true, no solo por mora_id", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    await correr();

    const upd = state.updates.find((u) => u.table === moras_credito);
    expect(upd).toBeDefined();
    // Sin este filtro, dos convenios simultáneos apagan los dos "con éxito"
    // y los dos anotan un DESACTIVACION por el mismo monto.
    expect(mencionaColumna(upd!.where, moras_credito.activa)).toBe(true);
    expect(mencionaColumna(upd!.where, moras_credito.mora_id)).toBe(true);
  });

  it("si otra ejecución ganó la carrera (0 filas): no anota historial y lo reporta", async () => {
    state.selectQueue = [[MORA_ACTIVA]];
    state.updateReturnQueue = [[]]; // el update condicional no afectó nada

    const res = await correr({ convenio_id: 102 });

    expect(res).toEqual({ desactivada: false });
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });

  // ── El monto auditado se lee BAJO el candado ─────────────────────────────
  it("lee la mora dentro de la transacción y con FOR UPDATE", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    // Camino de producción: sin `dbClient`, el helper abre su propia tx.
    await desactivarMoraPorConvenio(72, { convenio_id: 102 });

    expect(state.selects).toHaveLength(1);
    // Si la lectura vuelve a quedar afuera (antes del `db.transaction`), otra
    // ruta puede recalcular la fila entre el SELECT y el UPDATE: el update
    // apagaría el monto NUEVO y el historial anotaría el VIEJO.
    expect(state.selects[0].enTx).toBe(true);
    // Sin el candado de fila, estar adentro de la tx no alcanza: la fila se
    // puede mover igual entre las dos sentencias.
    expect(state.selects[0].forUpdate).toBe(true);
  });

  it("con dbClient (la tx del convenio) también lee con FOR UPDATE", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    await correr({ convenio_id: 102 });

    expect(state.selects).toHaveLength(1);
    expect(state.selects[0].forUpdate).toBe(true);
  });

  it("el historial anota el monto de la fila leída bajo el candado", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    await desactivarMoraPorConvenio(72, { convenio_id: 102 });

    const hist = state.inserts.find((i) => i.table === moras_historial);
    expect(hist!.values.monto_anterior).toBe("1286.34");
    expect(hist!.values.cuotas_atrasadas_anterior).toBe(3);
    // Y esa lectura pasó adentro del candado, no antes de abrirlo.
    expect(state.selects[0]).toEqual({ enTx: true, forUpdate: true });
  });

  // ── Atomicidad sin `dbClient` (el camino de producción) ──────────────────
  it("sin dbClient abre transacción propia y mete adentro las DOS escrituras", async () => {
    state.selectQueue = [[MORA_ACTIVA]];

    const res = await desactivarMoraPorConvenio(72, { convenio_id: 102 });

    expect(res.desactivada).toBe(true);
    expect(state.commits).toBe(1);
    expect(state.rollbacks).toBe(0);
    expect(state.updates.some((u) => u.table === moras_credito)).toBe(true);
    expect(state.inserts.some((i) => i.table === moras_historial)).toBe(true);
  });

  it("sin dbClient, si el historial falla la desactivación se revierte y el error sale", async () => {
    state.selectQueue = [[MORA_ACTIVA]];
    const insertOk = fakeDb.insert;
    fakeDb.insert = () => ({
      values: () => Promise.reject(new Error("historial caído simulado")),
    });

    try {
      // El caller de producción NO pasa dbClient: antes el fallo se tragaba y
      // el convenio devolvía éxito con la mora fuera del saldo y sin rastro.
      await expect(
        desactivarMoraPorConvenio(72, { convenio_id: 102 })
      ).rejects.toThrow("historial caído simulado");
    } finally {
      fakeDb.insert = insertOk;
    }

    expect(state.rollbacks).toBe(1);
    expect(state.commits).toBe(0);
  });
});
