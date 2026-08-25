import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = Record<string, any>;

const state = {
  selects: new Map<any, Row[]>(),
  reads: [] as any[],
  updates: [] as Array<{ table: any; values: Row }>,
};

function createTransaction() {
  return {
    select() {
      let table: any;
      const builder: any = {
        from(value: any) {
          table = value;
          state.reads.push(value);
          return builder;
        },
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return Promise.resolve(state.selects.get(table) ?? []);
        },
      };
      return builder;
    },
    update(table: any) {
      return {
        set(values: Row) {
          state.updates.push({ table, values });
          return {
            where() {
              const selected = state.selects.get(table) ?? [];
              const rows = table === convenios_pago
                ? selected.map((row) => ({ ...row, ...values }))
                : [];
              const query: any = Promise.resolve(rows);
              query.returning = () => Promise.resolve(rows);
              return query;
            },
          };
        },
      };
    },
  };
}

let transactionCalls = 0;
let transactionExecutor = createTransaction();

const fakeDb = {
  transaction: async (callback: (tx: typeof transactionExecutor) => Promise<unknown>) => {
    transactionCalls++;
    return callback(transactionExecutor);
  },
};

mock.module("../database", () => ({ db: fakeDb }));
mock.module("./latefee", () => ({
  contarCuotasVencidasReales: mock(() => Promise.resolve(0)),
  createMora: mock(() => Promise.resolve({ success: true })),
}));
mock.module("./payments", () => ({
  getPagosDelMesActual: mock(() => Promise.resolve([])),
}));
mock.module("../routers", () => ({ creditRouter: {} }));

const {
  processConvenioPayment,
  processConvenioPaymentEnTx,
} = await import("./paymentAgreement");
const {
  convenio_cuotas,
  convenios_pago,
  creditos,
  cuotas_credito,
} = await import("../database/db");

const params = {
  credito_id: 10,
  monto_pago: 500,
  creditoInfo: {
    credito: {},
    inversionistas: [],
    cuotasPendientes: [],
  },
  pagoMetadata: {
    montoBoleta: "500.00",
    registerBy: 1,
  },
} as never;

const activeAgreement = {
  convenio_id: 77,
  credito_id: 10,
  monto_total_convenio: "1000.00",
  numero_meses: 2,
  cuota_mensual: "500.00",
  fecha_convenio: new Date("2026-01-01T00:00:00Z"),
  monto_pagado: "500.00",
  monto_pendiente: "500.00",
  pagos_realizados: 1,
  pagos_pendientes: 1,
  activo: true,
  completado: false,
  motivo: null,
  observaciones: null,
  cuotas_convenio: [101, 102],
  created_by: 1,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
};

describe("processConvenioPaymentEnTx", () => {
  beforeEach(() => {
    state.selects.clear();
    state.reads.length = 0;
    state.updates.length = 0;
    transactionCalls = 0;
    transactionExecutor = createTransaction();
  });

  it("usa el tx inyectado y devuelve el resultado existente cuando no hay convenio activo", async () => {
    state.selects.set(convenios_pago, []);

    const result = await processConvenioPaymentEnTx(params, transactionExecutor as never);

    expect(result).toEqual({
      success: false,
      message: "No active payment agreement found for this credit",
      convenio: null,
      pago_completo: false,
      monto_aplicado: "0",
      monto_restante: "0",
    });
    expect(state.reads).toEqual([convenios_pago]);
    expect(state.updates).toHaveLength(0);
    expect(transactionCalls).toBe(0);
  });

  it("completa convenio y ejecuta todos los reads y writes con el tx inyectado", async () => {
    state.selects.set(convenios_pago, [activeAgreement]);
    state.selects.set(convenio_cuotas, [
      { cuota_convenio_id: 901, convenio_id: 77, numero_cuota: 2 },
    ]);

    const result = await processConvenioPaymentEnTx(params, transactionExecutor as never);

    expect(result).toMatchObject({
      success: true,
      message: "¡Convenio completado exitosamente!",
      convenio: {
        convenio_id: 77,
        monto_pagado: "1000.00",
        monto_pendiente: "0.00",
        pagos_realizados: 2,
        pagos_pendientes: 0,
        completado: true,
        activo: false,
      },
      pago_completo: true,
      monto_aplicado: "500.00",
      monto_restante: "0.00",
    });
    expect(state.reads).toEqual([convenios_pago, convenio_cuotas]);
    expect(state.updates.map(({ table }) => table)).toEqual([
      convenios_pago,
      cuotas_credito,
      creditos,
      convenio_cuotas,
    ]);
    expect(state.updates.find(({ table }) => table === cuotas_credito)?.values).toEqual({
      pagado: true,
    });
    expect(state.updates.find(({ table }) => table === creditos)?.values).toEqual({
      statusCredit: "ACTIVO",
    });
    expect(transactionCalls).toBe(0);
  });
});

describe("processConvenioPayment", () => {
  beforeEach(() => {
    state.selects.clear();
    state.reads.length = 0;
    state.updates.length = 0;
    transactionCalls = 0;
    transactionExecutor = createTransaction();
  });

  it("abre exactamente una transacción", async () => {
    state.selects.set(convenios_pago, []);

    const result = await processConvenioPayment(params);

    expect(result.success).toBe(false);
    expect(transactionCalls).toBe(1);
  });
});
