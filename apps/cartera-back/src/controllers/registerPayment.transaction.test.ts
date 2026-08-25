import { describe, expect, it, mock } from "bun:test";

const events: string[] = [];
const lateFailure = new Error("payment write failed");
const historyFailure = new Error("mora history insert failed");
const stagedWrites: unknown[] = [];
const persistedWrites: unknown[] = [];
let selectCall = 0;
let rolledBackWriteCount = 0;
let scenario: "late-after-payment" | "mora-history" = "late-after-payment";

const nestedTransaction = mock(
  async (callback: (savepoint: typeof tx) => Promise<unknown>) => callback(tx)
);

const updateMoraEnTx = mock(
  async (_params: unknown, _tx: unknown, options?: { historyRequired?: boolean }) => {
    stagedWrites.push({ type: "mora" });
    events.push("mora:staged");

    if (options?.historyRequired === false) {
      try {
        await nestedTransaction(async () => {
          events.push("history:failure");
          throw historyFailure;
        });
      } catch {
        // Espejo del modo legado: historial best-effort mediante savepoint.
      }
      return { success: true, mora: {}, newStatus: "ACTIVO" };
    }

    events.push("history:failure");
    throw historyFailure;
  }
);

const tx = {
  select: mock(() => {
    selectCall++;
    const currentCall = selectCall;
    const credito = {
      credito_id: 10,
      numero_credito_sifco: "CRED-10",
      usuario_id: 20,
      statusCredit: scenario === "mora-history" ? "MOROSO" : "ACTIVO",
      cuota: "100",
      permite_abono_capital: false,
      seguro_10_cuotas: "0",
      gps: "0",
      membresias_pago: "0",
    };
    const rowsByCall: Record<number, unknown[]> = {
      1: [],
      2: [
        {
          credito,
          saldo_a_favor: "0",
          usuario_id: 20,
          mora:
            scenario === "mora-history"
              ? {
                  mora_id: 90,
                  credito_id: 10,
                  activa: true,
                  porcentaje_mora: "1",
                  monto_mora: "50",
                  cuotas_atrasadas: 1,
                  created_at: null,
                  updated_at: null,
                }
              : null,
        },
      ],
      3: [],
      4: [],
      5: [
        {
          credito_id: 10,
          numero_credito_sifco: "CRED-10",
          usuario_id: 20,
          seguro_10_cuotas: "0",
          gps: "0",
          iva_12: "0",
          deudatotal: "100",
          cuota_id: null,
          cuota: null,
          cuota_interes: null,
        },
      ],
      6: [],
    };

    let result: Promise<unknown[]> | undefined;
    const execute = () => {
      if (!result) {
        const lateFailureCall = scenario === "mora-history" ? 5 : 7;
        if (currentCall === lateFailureCall) {
          events.push("select:late-failure");
          result = Promise.reject(lateFailure);
        } else {
          result = Promise.resolve(rowsByCall[currentCall] ?? []);
        }
      }
      return result;
    };
    const builder: any = {
      from: () => builder,
      leftJoin: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        execute().then(resolve, reject),
    };
    return builder;
  }),
  insert: mock((table: unknown) => ({
    values: (values: unknown) => {
      stagedWrites.push({ table, values });
      events.push("insert:staged");
      return {
        returning: () => Promise.resolve([{ pago_id: 501 }]),
      };
    },
  })),
  transaction: nestedTransaction,
};

const dbTransaction = mock(
  async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    events.push("transaction:start");
    try {
      const result = await callback(tx);
      persistedWrites.push(...stagedWrites);
      stagedWrites.length = 0;
      events.push("transaction:commit");
      return result;
    } catch (error) {
      rolledBackWriteCount = stagedWrites.length;
      stagedWrites.length = 0;
      events.push("transaction:rollback");
      throw error;
    }
  }
);

const lockQuery = mock(async (text: string) => {
  events.push(text.includes("unlock") ? "unlock" : "lock");
});
const lockRelease = mock(() => events.push("release"));

mock.module("../database", () => ({
  db: {
    transaction: dbTransaction,
  },
  lockPool: {
    connect: mock(async () => {
      events.push("connect");
      return { query: lockQuery, release: lockRelease };
    }),
  },
}));

mock.module("../utils/withAuditContext", () => ({
  withCapitalContext: mock(),
  setCapitalSource: mock(),
}));
mock.module("./latefee", () => ({ updateMoraEnTx }));
mock.module("./payments", () => ({
  insertPagosCreditoInversionistas: mock(),
  insertPagosCreditoInversionistasV2: mock(),
}));
mock.module("./investor", () => ({
  processAndReplaceCreditInvestors: mock(),
}));
mock.module("./paymentAgreement", () => ({
  processConvenioPaymentEnTx: mock(),
}));
mock.module("./abonosCapital", () => ({
  distribuirAbonoCapitalEspejo: mock(),
}));
mock.module("./updateCredit", () => ({ recalcularPagosCredito: mock() }));

const { insertPayment } = await import("./registerPayment");

describe("insertPayment transaction boundary", () => {
  it("borra una escritura previa al fallar y libera el lock después del rollback", async () => {
    events.length = 0;
    stagedWrites.length = 0;
    persistedWrites.length = 0;
    selectCall = 0;
    rolledBackWriteCount = 0;
    scenario = "late-after-payment";
    dbTransaction.mockClear();
    nestedTransaction.mockClear();
    updateMoraEnTx.mockClear();
    lockQuery.mockClear();
    lockRelease.mockClear();

    const set = { status: 0 };
    const result = await insertPayment({
      body: {
        credito_id: 10,
        usuario_id: 20,
        monto_boleta: 100,
        otros: 100,
        fecha_pago: "2026-08-24",
        cuotaApagar: 1,
        url_boletas: [],
        banco_id: 3,
        numeroAutorizacion: "AUTH-10",
        registerBy: "tester@clubcashin.com",
        fecha_boleta: "2026-08-24",
      },
      set,
    });

    expect(result).toMatchObject({
      success: false,
      message: "Internal server error",
      error: lateFailure.message,
    });
    expect(set.status).toBe(500);
    expect(dbTransaction).toHaveBeenCalledTimes(1);
    expect(rolledBackWriteCount).toBe(1);
    expect(stagedWrites).toHaveLength(0);
    expect(persistedWrites).toHaveLength(0);
    expect(events).toEqual([
      "connect",
      "lock",
      "transaction:start",
      "insert:staged",
      "select:late-failure",
      "transaction:rollback",
      "unlock",
      "release",
    ]);
  });

  it("hace rollback total si falla el historial de mora sin abrir savepoint", async () => {
    events.length = 0;
    stagedWrites.length = 0;
    persistedWrites.length = 0;
    selectCall = 0;
    rolledBackWriteCount = 0;
    scenario = "mora-history";
    dbTransaction.mockClear();
    nestedTransaction.mockClear();
    updateMoraEnTx.mockClear();
    lockQuery.mockClear();
    lockRelease.mockClear();

    const set = { status: 0 };
    const result = await insertPayment({
      body: {
        credito_id: 10,
        usuario_id: 20,
        monto_boleta: 100,
        fecha_pago: "2026-08-24",
        cuotaApagar: 1,
        url_boletas: [],
        banco_id: 3,
        numeroAutorizacion: "AUTH-MORA-10",
        registerBy: "tester@clubcashin.com",
        fecha_boleta: "2026-08-24",
      },
      set,
    });

    expect(result).toMatchObject({
      success: false,
      message: "Internal server error",
      error: historyFailure.message,
    });
    expect(set.status).toBe(500);
    expect(updateMoraEnTx).toHaveBeenCalledTimes(1);
    expect(nestedTransaction).not.toHaveBeenCalled();
    expect(rolledBackWriteCount).toBe(1);
    expect(stagedWrites).toHaveLength(0);
    expect(persistedWrites).toHaveLength(0);
    expect(events).toEqual([
      "connect",
      "lock",
      "transaction:start",
      "mora:staged",
      "history:failure",
      "transaction:rollback",
      "unlock",
      "release",
    ]);
  });
});
