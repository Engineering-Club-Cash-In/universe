import { describe, expect, it, mock, beforeEach } from "bun:test";

// ============================================================================
// Fake db para desactivarMoraSiCreditoAlDia
//
// El helper hace (en orden):
//   1. db.select(...).from(moras_credito).where(...)            → moras activas
//   2. db.select(...).from(creditos).where(...)                 → status del crédito
//   3. db.select(...).from(cuotas_credito).innerJoin(...).where → cuotas + hasPaidPayment
//   4. db.update(moras_credito).set(...).where(...).returning() → apagar mora
//   5. db.update(creditos).set(...).where(...)                  → MOROSO → ACTIVO
//   6. db.insert(moras_historial).values(...)                   → evento DESACTIVACION
//
// La fake alimenta los SELECT por orden de llamada y graba todos los writes.
// ============================================================================

type SelectResult = any[];

const state: {
  selectQueue: SelectResult[];
  selectCalls: number;
  updates: Array<{ table: any; set: any; returning: boolean }>;
  inserts: Array<{ table: any; values: any }>;
  updateReturningQueue: SelectResult[];
  failNextUpdate: boolean;
} = {
  selectQueue: [],
  selectCalls: 0,
  updates: [],
  inserts: [],
  updateReturningQueue: [],
  failNextUpdate: false,
};

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
  update: (table: any) => ({
    set: (setValues: any) => ({
      where: () => {
        if (state.failNextUpdate) {
          state.failNextUpdate = false;
          const failing: any = Promise.resolve([]);
          failing.returning = () =>
            Promise.reject(new Error("db caída simulada"));
          return failing;
        }
        const entry = { table, set: setValues, returning: false };
        state.updates.push(entry);
        const rows = state.updateReturningQueue.shift() ?? [];
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
      return Promise.resolve([]);
    },
  }),
};

mock.module("../database", () => ({ db: {}, client: {} }));

const latefee = await import("./latefee");
const { moras_credito, creditos, moras_historial } = await import(
  "../database/db/schema"
);

const getHelper = () => {
  const fn = Reflect.get(latefee, "desactivarMoraSiCreditoAlDia");
  expect(fn).toBeFunction();
  return (credito_id: number) =>
    (fn as any)(credito_id, { dbClient: fakeDb }) as Promise<{
      desactivada: boolean;
      error?: string;
    }>;
};

const MORA_ACTIVA = {
  mora_id: 95201,
  credito_id: 8685,
  monto_mora: "1286.34",
  cuotas_atrasadas: 1,
  porcentaje_mora: "1.12",
};

const CREDITO_MOROSO = { statusCredit: "MOROSO" };

// Cuota ya validada hoy (pagada) + resto de cuotas al día → 0 vencidas
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

// Una cuota vieja sigue impaga y sin pago validado → 1 vencida
const CUOTAS_CON_ATRASO = [
  {
    fecha_vencimiento: new Date("2026-06-15T06:00:00.000Z"),
    pagado: false,
    hasPaidPayment: false,
    statusCredit: "MOROSO",
  },
  ...CUOTAS_AL_DIA,
];

beforeEach(() => {
  state.selectQueue = [];
  state.selectCalls = 0;
  state.updates = [];
  state.inserts = [];
  state.updateReturningQueue = [];
  state.failNextUpdate = false;
});

describe("desactivarMoraSiCreditoAlDia", () => {
  it("apaga la mora, baja MOROSO→ACTIVO y registra DESACTIVACION cuando el crédito queda al día", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[{ mora_id: 95201 }]];

    const result = await getHelper()(8685);

    expect(result.desactivada).toBe(true);

    // Update 1: la mora queda en 0 e inactiva
    const moraUpdate = state.updates.find((u) => u.table === moras_credito);
    expect(moraUpdate).toBeDefined();
    expect(moraUpdate!.set).toMatchObject({
      monto_mora: "0",
      cuotas_atrasadas: 0,
      activa: false,
    });
    expect(moraUpdate!.returning).toBe(true);

    // Update 2: el crédito baja a ACTIVO
    const statusUpdate = state.updates.find((u) => u.table === creditos);
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate!.set).toEqual({ statusCredit: "ACTIVO" });

    // Historial: evento DESACTIVACION con el monto anterior real
    const historial = state.inserts.find((i) => i.table === moras_historial);
    expect(historial).toBeDefined();
    expect(historial!.values).toMatchObject({
      credito_id: 8685,
      mora_id: 95201,
      tipo_evento: "DESACTIVACION",
      monto_anterior: "1286.34",
      monto_nuevo: "0",
    });
  });

  it("no toca nada cuando el crédito aún tiene cuotas vencidas sin validar", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_CON_ATRASO];

    const result = await getHelper()(8685);

    expect(result.desactivada).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("sale temprano sin consultar cuotas cuando no hay mora activa", async () => {
    state.selectQueue = [[]];

    const result = await getHelper()(8685);

    expect(result.desactivada).toBe(false);
    expect(state.selectCalls).toBe(1);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("no baja el status cuando el crédito no está MOROSO (p.ej. EN_CONVENIO)", async () => {
    state.selectQueue = [
      [MORA_ACTIVA],
      [{ statusCredit: "EN_CONVENIO" }],
      // EN_CONVENIO está excluido de mora → sus cuotas no cuentan como vencidas
      CUOTAS_AL_DIA.map((c) => ({ ...c, statusCredit: "EN_CONVENIO" })),
    ];
    state.updateReturningQueue = [[{ mora_id: 95201 }]];

    const result = await getHelper()(8685);

    expect(result.desactivada).toBe(true);
    const statusUpdate = state.updates.find((u) => u.table === creditos);
    expect(statusUpdate).toBeUndefined();
  });

  it("no duplica el historial si el cron ya había apagado la mora (update condicional no afecta filas)", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.updateReturningQueue = [[]]; // returning vacío: otra corrida ganó la carrera

    const result = await getHelper()(8685);

    expect(result.desactivada).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("nunca lanza: un error de db se reporta en el resultado sin romper la validación del pago", async () => {
    state.selectQueue = [[MORA_ACTIVA], [CREDITO_MOROSO], CUOTAS_AL_DIA];
    state.failNextUpdate = true;

    const result = await getHelper()(8685);

    expect(result.desactivada).toBe(false);
    expect(result.error).toBeDefined();
  });
});
