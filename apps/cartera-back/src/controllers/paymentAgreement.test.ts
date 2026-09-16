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

/**
 * El ORDEN dentro de `createPaymentAgreement`, que es lo que la Fase 2 promete:
 * el crédito se queda en el bucket que tenía AL FIRMAR.
 *
 * Ese bucket se deriva de la mora activa y del status del crédito, y los dos
 * pasos que siguen los destruyen —se borra la mora y el status pasa a
 * EN_CONVENIO—. Con la lectura al final (como estaba, review de Codex P2)
 * `bucketAntesDelConvenio` se quedaba sin sus dos primeras fuentes y devolvía
 * B0 para todo crédito sin historial previo: el "borrón y cuenta nueva" que
 * esta fase existe para impedir.
 *
 * Se afirma sobre la fuente porque el daño no se ve en el resultado de la
 * función —devuelve el convenio igual—, solo en qué bucket quedó escrito.
 */
describe("createPaymentAgreement: orden de la salida del régimen normal", () => {
  const fuente = require("node:fs").readFileSync(
    new URL("./paymentAgreement.ts", import.meta.url).pathname,
    "utf8",
  ) as string;
  const cuerpo = fuente.slice(
    fuente.indexOf("export async function createPaymentAgreement("),
  );

  it("lee el bucket antes de borrar la mora y de cambiar el status", () => {
    const lectura = cuerpo.indexOf("bucketAntesDelConvenio(");
    const borrado = cuerpo.indexOf(".delete(moras_credito)");
    const cambioStatus = cuerpo.indexOf('statusCredit: "EN_CONVENIO"');

    expect(lectura).toBeGreaterThan(-1);
    expect(borrado).toBeGreaterThan(-1);
    expect(cambioStatus).toBeGreaterThan(-1);
    expect(lectura).toBeLessThan(borrado);
    expect(lectura).toBeLessThan(cambioStatus);
  });

  it("toma el lock por crédito antes de leer el bucket", () => {
    const lock = cuerpo.indexOf("pg_advisory_xact_lock");
    const lectura = cuerpo.indexOf("bucketAntesDelConvenio(");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(lectura);
  });
});
