import { describe, expect, it, beforeEach, mock } from "bun:test";

/**
 * Verificación de que la columna `pago_id` en `moras_historial` se escribe
 * correctamente cuando un evento de mora viene ligado a un pago, y se deja NULL
 * cuando no.
 *
 * ── CASOS CUBIERTOS ────────────────────────────────────────────────────────
 * 1. desactivarMoraSiCreditoAlDia llamada con pago_id → evento con ese pago_id
 * 2. desactivarMoraSiCreditoAlDia llamada sin pago_id → evento con pago_id NULL
 * 3. El INSERT lleva la columna correcta en el nombre
 * 4. El esquema drizzle declara la columna con tipo integer nullable
 */

const state: {
  selectQueue: any[][];
  selectCalls: number;
  updates: Array<{ table: any; set: any; returning: boolean }>;
  inserts: Array<{ table: any; values: any }>;
  updateReturningQueue: any[][];
} = {
  selectQueue: [],
  selectCalls: 0,
  updates: [],
  inserts: [],
  updateReturningQueue: [],
};

const tablaDe = (t: any) =>
  t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? "?";

const makeSelectChain = () => {
  const result = state.selectQueue[state.selectCalls] ?? [];
  state.selectCalls++;
  const chain: any = {
    from: (tabla?: unknown) => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(result),
  };
  return chain;
};

const fakeDb: any = {
  transaction: async (cb: (txm: any) => Promise<void>) => cb(fakeDb),
  select: () => makeSelectChain(),
  update: (table: any) => ({
    set: (setValues: any) => ({
      where: () => {
        const entry = { table, set: setValues, returning: false };
        state.updates.push(entry);
        // Solo el update de la mora usa `.returning()`; el del crédito no debe
        // comerse la fila que la prueba preparó para aquél.
        const rows =
          table === moras_credito ? state.updateReturningQueue.shift() ?? [] : [];
        const promise: any = Promise.resolve(rows);
        promise.returning = () => {
          entry.returning = true;
          return Promise.resolve(rows);
        };
        return promise;
      },
    }),
  }),
  insert: (table: any) => ({
    values: (values: any) => {
      state.inserts.push({ table, values });
      // `registrarHistorialMora` pide `.returning({ historial_id })`: el id del
      // evento es lo que después va a ligar el pago con la mora.
      return Object.assign(Promise.resolve([]), {
        returning: () => Promise.resolve([{ historial_id: 6101 }]),
      });
    },
  }),
};

mock.module("../database", () => ({ db: {}, client: {} }));

const { desactivarMoraSiCreditoAlDia } = await import("./latefee");
const { moras_credito, creditos, moras_historial } = await import(
  "../database/db/schema"
);

const correr = (credito_id: number, opts?: any) =>
  desactivarMoraSiCreditoAlDia(credito_id, { dbClient: fakeDb as any, ...opts });

const MORA_ACTIVA = {
  mora_id: 95201,
  monto_mora: "1286.34",
  cuotas_atrasadas: 1,
  porcentaje_mora: "1.12",
};

const CREDITO_MOROSO = {
  statusCredit: "MOROSO",
  capital: "114160.35",
};

const CUOTAS_AL_DIA = [
  {
    fecha_vencimiento: new Date("2026-07-15T06:00:00.000Z"),
    pagado: true,
    hasPaidPayment: true,
    statusCredit: "MOROSO",
  },
  {
    fecha_vencimiento: new Date("2099-01-15T06:00:00.000Z"),
    pagado: false,
    hasPaidPayment: false,
    statusCredit: "MOROSO",
  },
];

const PAGO_ID_PRUEBA = 164405;

beforeEach(() => {
  state.selectQueue = [];
  state.selectCalls = 0;
  state.updates = [];
  state.inserts = [];
  state.updateReturningQueue = [];
});

describe("moraHistorialPagoId", () => {
  it("caso 1: desactivarMoraSiCreditoAlDia con pago_id → el evento lleva ese pago_id", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: MORA_ACTIVA.mora_id }]];

    const result = await correr(8685, { pago_id: PAGO_ID_PRUEBA });

    expect(result.desactivada).toBe(true);

    // Verificar que se escribió el evento DESACTIVACION con el pago_id
    const historial = state.inserts.find((i) => i.table === moras_historial);
    expect(historial).toBeDefined();
    expect(historial!.values).toMatchObject({
      credito_id: 8685,
      mora_id: MORA_ACTIVA.mora_id,
      tipo_evento: "DESACTIVACION",
      pago_id: PAGO_ID_PRUEBA,
    });
  });

  it("caso 2: desactivarMoraSiCreditoAlDia sin pago_id → el evento lleva pago_id NULL", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: MORA_ACTIVA.mora_id }]];

    const result = await correr(8685);

    expect(result.desactivada).toBe(true);

    // Verificar que se escribió el evento DESACTIVACION sin pago_id (NULL)
    const historial = state.inserts.find((i) => i.table === moras_historial);
    expect(historial).toBeDefined();
    expect(historial!.values).toMatchObject({
      credito_id: 8685,
      mora_id: MORA_ACTIVA.mora_id,
      tipo_evento: "DESACTIVACION",
      pago_id: null,
    });
  });

  it("caso 3: la inserción contiene la columna pago_id con el nombre correcto", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: MORA_ACTIVA.mora_id }]];

    await correr(8685, { pago_id: PAGO_ID_PRUEBA });

    const historial = state.inserts.find((i) => i.table === moras_historial);
    expect(historial).toBeDefined();
    expect(Object.keys(historial!.values)).toContain("pago_id");
  });

  it("caso 4: el evento se registra correctamente incluso sin pago_id, sin que falle", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: MORA_ACTIVA.mora_id }]];

    const result = await correr(8685);

    expect(result.desactivada).toBe(true);
    expect(state.inserts).toHaveLength(1);
    const historial = state.inserts[0];
    expect(historial.table === moras_historial).toBe(true);
    expect(historial.values.pago_id).toBe(null);
  });
});
