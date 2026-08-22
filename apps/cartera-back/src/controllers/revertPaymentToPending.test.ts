import { beforeEach, describe, expect, mock, test } from "bun:test";

const emitted: Array<Record<string, unknown>> = [];
let transactionError: unknown;
let selectResults: unknown[][] = [];
let cofidiResult: Record<string, unknown> = { success: true, anulado: true };

const tx = {
  select: mock(() => ({
    from: () => ({
      where: () => {
        const rows = selectResults.shift() ?? [];
        return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
      },
    }),
  })),
  update: mock(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
  delete: mock(() => ({ where: () => Promise.resolve() })),
};

const transaction = mock(async (callback: (value: typeof tx) => Promise<unknown>) => {
  if (transactionError !== undefined) throw transactionError;
  return callback(tx);
});
const reverseInvestors = mock(() => Promise.resolve());
const voidInvoice = mock(() => Promise.resolve(cofidiResult));

mock.module("../database", () => ({ db: { transaction } }));
mock.module("../utils/withAuditContext", () => ({ setCapitalSource: mock(() => Promise.resolve()) }));
mock.module("./investor", () => ({ processAndReplaceCreditInvestorsReverse: reverseInvestors }));
mock.module("./reversePayment", () => ({ anularFacturaEnCofidi: voidInvoice }));
mock.module("../utils/structuredLogger", () => ({
  emitPaymentReversalToPending: (event: Record<string, unknown>) => emitted.push(event),
}));

const { revertPaymentToPending } = await import("./revertPaymentToPending");

const credit = {
  numero_credito_sifco: "SYNTHETIC-10",
  cuota: "100.00",
  capital: "800.00",
  cuota_interes: "8.00",
  iva_12: "0.96",
  porcentaje_interes: "1",
  seguro_10_cuotas: "0",
  gps: "0",
  membresias_pago: "0",
  deudatotal: "808.96",
};

describe("revertPaymentToPending observability contract", () => {
  beforeEach(() => {
    emitted.length = 0;
    transactionError = undefined;
    selectResults = [];
    cofidiResult = { success: true, anulado: true };
    transaction.mockClear();
    reverseInvestors.mockClear();
    voidInvoice.mockClear();
  });

  test("preserves the historical validation response and emits a safe rejection", async () => {
    const set = { status: 0 };
    const response = await revertPaymentToPending({ body: {}, set });
    expect(set.status).toBe(400);
    expect(response).toEqual({ message: "Validation failed", errors: { credito_id: ["Required"], pago_id: ["Required"] } });
    expect(transaction).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ outcome: "rejected", reasonCode: "schema_invalid" });
  });

  test("executes the transaction callback and preserves the already-pending body", async () => {
    selectResults = [[{ validationStatus: "pending" }], [credit]];
    const set = { status: 0 };
    const response = await revertPaymentToPending({ body: { credito_id: 10, pago_id: 30 }, set });
    expect(set.status).toBe(200);
    expect(response).toEqual({
      message: "Payment reversed to pending successfully",
      data: {
        pago_id: 30,
        credito_id: 10,
        numero_credito_sifco: "SYNTHETIC-10",
        cuota: "100.00",
        message: "Inversiones reversadas exitosamente (el pago ya estaba pendiente)",
      },
    });
    expect(reverseInvestors).toHaveBeenCalledWith(10, 30);
    expect(emitted[0]).toMatchObject({ outcome: "completed", reversalPath: "already_pending", processedCount: 0, succeededCount: 0, failedCount: 0 });
  });

  test("executes invoice processing and emits only aggregate partial counts", async () => {
    const invoice = { factura_id: 1, uuid: "synthetic-uuid", serie: "S", numero: "1", receptor_nit: "000", fecha_certificacion: null, fecha_emision: null };
    selectResults = [[{ validationStatus: "validated", abono_capital: "100.00" }], [credit], [[invoice][0]]];
    cofidiResult = { success: false, anulado: false, error: "PROVIDER", mensaje: "synthetic provider detail" };
    const set = { status: 0 };
    const response = await revertPaymentToPending({ body: { credito_id: 10, pago_id: 30 }, set });
    expect(set.status).toBe(200);
    expect(response).toMatchObject({ message: "Payment reversed to pending successfully", data: { pago_id: 30, credito_id: 10, nuevoCapital: "900" } });
    expect(voidInvoice).toHaveBeenCalledTimes(1);
    expect(emitted[0]).toMatchObject({ outcome: "partially_completed", reversalPath: "validated_payment", processedCount: 1, succeededCount: 0, failedCount: 1 });
    for (const key of ["credito_id", "pago_id", "factura_id", "uuid", "error", "mensaje"]) expect(emitted[0]).not.toHaveProperty(key);
  });

  test("preserves not-found status and body while emitting only a finite reason", async () => {
    transactionError = new Error("Payment not found");
    const set = { status: 0 };
    const response = await revertPaymentToPending({ body: { credito_id: 10, pago_id: 30 }, set });
    expect(set.status).toBe(404);
    expect(response).toEqual({ message: "Internal server error", error: "Payment not found" });
    expect(emitted[0]).toMatchObject({ outcome: "rejected", reasonCode: "payment_not_found" });
    expect(emitted[0]).not.toHaveProperty("error");
  });
});
