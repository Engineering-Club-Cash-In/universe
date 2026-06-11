import { beforeEach, describe, expect, it, mock } from "bun:test";

let transactionCalls = 0;
let globalInsertCalls = 0;
let txInsertCalls = 0;

const creditRow = { credito_id: 123 };
const initialInstallment = [{ cuota_id: 1 }];
const regularInstallments = [
  { cuota_id: 2, numero_cuota: 1, fecha_vencimiento: "2026-06-15" },
];

const createInsertBuilder = (scope: "global" | "tx") => {
  const callNumber = scope === "global" ? ++globalInsertCalls : ++txInsertCalls;

  return {
    values: () => {
      if (callNumber === 6) {
        throw new Error("payments insert failed");
      }

      return {
        returning: () => {
          if (callNumber === 1) return Promise.resolve([creditRow]);
          if (callNumber === 4) return Promise.resolve(initialInstallment);
          if (callNumber === 5) return Promise.resolve(regularInstallments);
          return Promise.resolve([]);
        },
      };
    },
  };
};

mock.module("../database", () => {
  const tx = {
    insert: () => createInsertBuilder("tx"),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };

  return {
    db: {
      transaction: async (callback: (transactionClient: typeof tx) => Promise<unknown>) => {
        transactionCalls += 1;
        return callback(tx);
      },
      insert: () => createInsertBuilder("global"),
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    },
  };
});

mock.module("./users", () => ({
  findOrCreateUserByName: mock(() => Promise.resolve({ usuario_id: 77 })),
}));

mock.module("./advisor", () => ({
  findOrCreateAdvisorByName: mock(() => Promise.resolve({ asesor_id: 1 })),
  getAsesorConMenorCarga: mock(() => Promise.resolve(1)),
}));

mock.module("@cci/email", () => ({
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

const { insertCredit } = await import("./createCredit");

const validCreditBody = {
  usuario: "Cliente prueba",
  numero_credito_sifco: "TEST-001",
  capital: 1000,
  porcentaje_interes: 10,
  seguro_10_cuotas: 0,
  gps: 0,
  observaciones: "",
  no_poliza: "",
  como_se_entero: "CRM",
  plazo: 1,
  cuota: 1120,
  dia_pago_mensual: 15,
  membresias_pago: 0,
  porcentaje_royalti: 0,
  royalti: 0,
  categoria: "Vehiculo",
  nit: "CF",
  otros: 0,
  reserva: 0,
  asesor_id: 1,
  inversionistas: [
    {
      inversionista_id: 10,
      monto_aportado: 1000,
      porcentaje_cash_in: 100,
      porcentaje_inversion: 0,
    },
  ],
};

describe("insertCredit", () => {
  beforeEach(() => {
    transactionCalls = 0;
    globalInsertCalls = 0;
    txInsertCalls = 0;
  });

  it("ejecuta la creación del crédito dentro de una transacción", async () => {
    const set = { status: 200 };

    await insertCredit({ body: validCreditBody, set });

    expect(transactionCalls).toBe(1);
    expect(globalInsertCalls).toBe(0);
    expect(txInsertCalls).toBeGreaterThan(0);
    expect(set.status).toBe(500);
  });
});
