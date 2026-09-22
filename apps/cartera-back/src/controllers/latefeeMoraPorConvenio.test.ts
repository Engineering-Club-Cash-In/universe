import { describe, expect, it, mock, beforeEach } from "bun:test";

// ============================================================================
// Fake db para desactivarMoraPorConvenio
//
// El helper hace (en orden):
//   1. db.select(...).from(moras_credito).where(...)  → la mora activa (0 o 1)
//   2. db.update(moras_credito).set(...).where(...)   → apagarla
//   3. db.insert(moras_historial).values(...)         → evento DESACTIVACION
//
// Lo que se prueba es justamente lo que el DELETE duro del convenio NO hacía:
// que quede fila y quede rastro con el monto que se soltó.
// ============================================================================

type Fila = Record<string, unknown>;

const state: {
  selectQueue: Fila[][];
  selectCalls: number;
  updates: Array<{ table: unknown; set: Fila }>;
  inserts: Array<{ table: unknown; values: Fila }>;
  deletes: number;
} = { selectQueue: [], selectCalls: 0, updates: [], inserts: [], deletes: 0 };

const makeSelectChain = () => {
  const result = state.selectQueue[state.selectCalls] ?? [];
  state.selectCalls++;
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(result),
  };
  return chain;
};

const fakeDb = {
  select: () => makeSelectChain(),
  update: (table: unknown) => ({
    set: (setValues: Fila) => ({
      where: () => {
        state.updates.push({ table, set: setValues });
        return Promise.resolve([]);
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
};

mock.module("../database", () => ({ db: {}, client: {} }));

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
  state.updates = [];
  state.inserts = [];
  state.deletes = 0;
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
});
