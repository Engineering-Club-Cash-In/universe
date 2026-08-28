import { beforeEach, describe, expect, mock, test } from "bun:test";

const emitted: Array<Record<string, unknown>> = [];
let transactionError: unknown;
let transactionErrorAfterCallback: unknown;
let investorReverseBehavior: "no_op" | "persist_then_fail";
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
  const result = await callback(tx);
  if (transactionErrorAfterCallback !== undefined) throw transactionErrorAfterCallback;
  return result;
});
const reverseInvestors = mock(async (
  _creditoId: number,
  _pagoId: number,
  onPersisted?: () => void,
) => {
  if (investorReverseBehavior !== "no_op") onPersisted?.();
  if (investorReverseBehavior === "persist_then_fail") {
    throw new Error("synthetic later investor failure");
  }
});
const voidInvoice = mock(() => Promise.resolve(cofidiResult));
process.env.SUPABASE_DB_URL ??= "postgresql://127.0.0.1:1/synthetic";
process.env.RESEND_API_KEY ??= "synthetic-test-key";
process.env.EMAIL_DOMAIN ??= "example.invalid";
const { createRevertPaymentToPending, classifyRevertPaymentCredit, classifyRevertPendingTerminal } = await import("./revertPaymentToPending");
type Dependencies = NonNullable<Parameters<typeof createRevertPaymentToPending>[0]>;
const revertPaymentToPending = createRevertPaymentToPending({
  runTransaction: transaction as unknown as Dependencies["runTransaction"],
  reverseInvestors: reverseInvestors as unknown as Dependencies["reverseInvestors"],
  voidInvoice: voidInvoice as unknown as Dependencies["voidInvoice"],
  setCapitalSource: mock(() => Promise.resolve()) as unknown as Dependencies["setCapitalSource"],
  emitTerminal: (event) => emitted.push(event),
  // Stub del advisory lock: el real conecta al lockPool (no hay BD en tests).
  acquireLock: async () => async () => {},
});

const credit = {
  statusCredit: "ACTIVO",
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
    transactionErrorAfterCallback = undefined;
    investorReverseBehavior = "no_op";
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

  test("distinguishes missing credits from non-reversible credit states", () => {
    expect(classifyRevertPaymentCredit(undefined)).toBe("credit_not_found");
    expect(classifyRevertPaymentCredit({ statusCredit: "CANCELADO" })).toBe("state_conflict");
    expect(classifyRevertPaymentCredit({ statusCredit: "ACTIVO" })).toBeNull();
  });

  test("prioritizes local invoice inconsistency over provider partials", () => {
    expect(classifyRevertPendingTerminal({ failedCount: 2, localStateFailureCount: 1 })).toBe("local_state_inconsistent");
    expect(classifyRevertPendingTerminal({ failedCount: 1, localStateFailureCount: 0 })).toBe("partially_completed");
    expect(classifyRevertPendingTerminal({ failedCount: 0, localStateFailureCount: 0 })).toBe("completed");
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
    expect(reverseInvestors).toHaveBeenCalledWith(10, 30, expect.any(Function));
    expect(emitted[0]).toMatchObject({ outcome: "completed", reversalPath: "already_pending", processedCount: 0, succeededCount: 0, failedCount: 0 });
  });

  test("keeps a transaction failure after an investor no-op as an ordinary failure", async () => {
    selectResults = [[{ validationStatus: "pending" }], [credit]];
    transactionErrorAfterCallback = new Error("synthetic commit failure");
    const set = { status: 0 };

    const response = await revertPaymentToPending({ body: { credito_id: 10, pago_id: 30 }, set });

    expect(reverseInvestors).toHaveBeenCalledWith(10, 30, expect.any(Function));
    expect(set.status).toBe(500);
    expect(response).toEqual({ message: "Internal server error", error: "synthetic commit failure" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ outcome: "failed", errorCode: "unknown" });
  });

  test("classifies a later investor failure after one persisted write as local inconsistency", async () => {
    selectResults = [[{ validationStatus: "pending" }], [credit]];
    investorReverseBehavior = "persist_then_fail";
    const set = { status: 0 };

    const response = await revertPaymentToPending({ body: { credito_id: 10, pago_id: 30 }, set });

    expect(set.status).toBe(500);
    expect(response).toEqual({ message: "Internal server error", error: "synthetic later investor failure" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      outcome: "local_state_inconsistent",
      reversalPath: "already_pending",
      errorCode: "persistence_failed",
    });
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
