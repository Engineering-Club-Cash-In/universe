import { beforeEach, describe, expect, mock, test } from "bun:test";

const syntheticEnvironment = {
  SUPABASE_DB_URL: "postgresql://127.0.0.1:1/synthetic",
  RESEND_API_KEY: "synthetic-test-key",
  EMAIL_DOMAIN: "example.invalid",
} as const;
const previousEnvironment = Object.fromEntries(
  Object.keys(syntheticEnvironment).map((key) => [key, process.env[key]]),
) as Record<keyof typeof syntheticEnvironment, string | undefined>;
Object.assign(process.env, syntheticEnvironment);

const { createReversePayment, reversePayment } = await import("./reversePayment");
const { createCarteraStructuredLogger } = await import("../utils/structuredLogger");
const { pagos_credito } = await import("../database/db/schema");
for (const key of Object.keys(syntheticEnvironment) as Array<keyof typeof syntheticEnvironment>) {
  const previous = previousEnvironment[key];
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

describe("reversePayment observability contract", () => {
  test("preserves invalid-schema HTTP 400 and emits one safe rejection", async () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: "staging",
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      sink: (line) => lines.push(line),
    });
    const set = { status: 0 };
    const response = await reversePayment({ body: {}, set, telemetryLogger: logger });

    expect(set.status).toBe(400);
    expect(response).toEqual(expect.objectContaining({ message: "Validation failed", errors: expect.any(Object) }));
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(event).toEqual(expect.objectContaining({
      event: "payment.reversal",
      outcome: "rejected",
      previous_payment_state: "unknown",
      credit_updated: false,
      investments_reversed: false,
      manual_action_required: false,
      reason_code: "schema_invalid",
    }));
    for (const key of ["credito_id", "pago_id", "factura_id", "uuid", "monto", "message", "error", "stack"]) {
      expect(event).not.toHaveProperty(key);
    }
  });

  test("a broken clock and sink do not alter the validation response", async () => {
    const logger = createCarteraStructuredLogger({ sink: () => { throw new Error("synthetic sink failure"); } });
    const originalNow = Date.now;
    Date.now = () => { throw new Error("synthetic clock failure"); };
    try {
      const set = { status: 0 };
      const response = await reversePayment({ body: null, set, telemetryLogger: logger });
      expect(set.status).toBe(400);
      expect(response).toEqual(expect.objectContaining({ message: "Validation failed" }));
    } finally {
      Date.now = originalNow;
    }
  });
});

type ReversePaymentDependencies = NonNullable<Parameters<typeof createReversePayment>[0]>;

const pendingPayment = {
  pago_id: 30,
  credito_id: 10,
  cuota_id: null,
  validationStatus: "pending",
  registerBy: "synthetic-test",
  mora: "0",
  pagoConvenio: "0",
  pagado: false,
  capital_restante: "100",
  interes_restante: "10",
  iva_12_restante: "1.2",
  seguro_restante: "0",
  gps_restante: "0",
  membresias: "0",
  abono_capital: "0",
  abono_interes: "0",
  abono_iva_12: "0",
  abono_seguro: "0",
  abono_gps: "0",
  membresias_pago: "0",
  monto_boleta: "0",
};
const activeCredit = {
  creditos: {
    credito_id: 10,
    usuario_id: 20,
    statusCredit: "ACTIVO",
    capital: "1000",
    cuota_interes: "10",
    iva_12: "1.2",
    deudatotal: "1011.2",
    porcentaje_interes: "1",
    seguro_10_cuotas: "0",
    gps: "0",
    membresias_pago: "0",
    cuota: "100",
  },
  usuarios: { usuario_id: 20 },
};
const user = { usuario_id: 20, saldo_a_favor: "0" };

type RecordedUpdate = { table: unknown; payload: Record<string, unknown> };

function createTransactionTx(
  payment: Record<string, unknown> = pendingPayment,
  recordedUpdates: RecordedUpdate[] = [],
) {
  const selectResults: unknown[][] = [[payment], [activeCredit], [user], []];
  const takeRows = () => {
    const rows = selectResults.shift() ?? [];
    return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
  };
  const updateWhere = () =>
    Object.assign(Promise.resolve([]), {
      returning: () => Promise.resolve([]),
    });
  return {
    select: mock(() => ({
      from: () => ({
        innerJoin: () => ({ where: takeRows }),
        where: takeRows,
      }),
    })),
    update: mock((table: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        recordedUpdates.push({ table, payload });
        return { where: updateWhere };
      },
    })),
    delete: mock(() => ({
      where: () =>
        Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        }),
    })),
    // `setCapitalSource` (rama de pago YA aplicado) emite un SET de sesión.
    execute: mock(() => Promise.resolve([])),
  };
}

function createPersistenceHarness(
  reverseInvestors: ReversePaymentDependencies["reverseInvestors"],
  payment: Record<string, unknown> = pendingPayment,
  recordedUpdates: RecordedUpdate[] = [],
) {
  const tx = createTransactionTx(payment, recordedUpdates);
  const runTransaction = mock(async (callback: (value: typeof tx) => Promise<unknown>) => {
    await callback(tx);
    throw new Error("synthetic later transaction failure");
  });
  const handler = createReversePayment({
    runTransaction: runTransaction as unknown as ReversePaymentDependencies["runTransaction"],
    reverseInvestors,
    reverseCapitalPayment: mock(() => Promise.resolve(undefined)) as unknown as ReversePaymentDependencies["reverseCapitalPayment"],
    // Lock identidad: acá no hay concurrencia que serializar y el real
    // abriría conexión al lockPool.
    withCreditLock: ((_creditoId: number, fn: () => Promise<unknown>) =>
      fn()) as ReversePaymentDependencies["withCreditLock"],
    // El refresco de proyección corre DESPUÉS del commit; en este harness la
    // transacción revienta antes, así que nunca debería llamarse.
    refrescarProyeccion: mock(() =>
      Promise.resolve({ corrio: true as const }),
    ) as unknown as ReversePaymentDependencies["refrescarProyeccion"],
  });
  return { handler, runTransaction };
}

describe("reversePayment global-persistence evidence", () => {
  let lines: string[];
  let logger: ReturnType<typeof createCarteraStructuredLogger>;

  beforeEach(() => {
    lines = [];
    logger = createCarteraStructuredLogger({
      environment: "staging",
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      sink: (line) => lines.push(line),
    });
  });

  test("keeps an investor no-op followed by a transaction failure as an ordinary failure", async () => {
    const reverseInvestors = mock(async (
      _creditoId: number,
      _pagoId: number,
      _onPersisted?: () => void,
    ) => []);
    const { handler } = createPersistenceHarness(
      reverseInvestors as unknown as ReversePaymentDependencies["reverseInvestors"],
    );
    const set = { status: 0 };

    const response = await handler({
      body: { credito_id: 10, pago_id: 30 },
      set,
      telemetryLogger: logger,
    });

    expect(reverseInvestors).toHaveBeenCalledWith(10, 30, expect.any(Function));
    expect(set.status).toBe(500);
    expect(response).toEqual({
      message: "Internal server error",
      error: "synthetic later transaction failure",
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "payment.reversal",
      outcome: "failed",
      manual_action_required: false,
      error_code: "unknown",
    });
  });

  test("preserves actual investor-write evidence when a later investor operation fails", async () => {
    const reverseInvestors = mock(async (
      _creditoId: number,
      _pagoId: number,
      onPersisted?: () => void,
    ) => {
      onPersisted?.();
      throw new Error("synthetic later investor failure");
    });
    const { handler } = createPersistenceHarness(
      reverseInvestors as unknown as ReversePaymentDependencies["reverseInvestors"],
    );
    const set = { status: 0 };

    const response = await handler({
      body: { credito_id: 10, pago_id: 30 },
      set,
      telemetryLogger: logger,
    });

    expect(reverseInvestors).toHaveBeenCalledWith(10, 30, expect.any(Function));
    expect(set.status).toBe(500);
    expect(response).toEqual({
      message: "Internal server error",
      error: "synthetic later investor failure",
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "payment.reversal",
      outcome: "partially_completed",
      manual_action_required: true,
      reason_code: "local_state_inconsistent",
    });
  });
});

describe("reversePayment limpia fecha_aplicado", () => {
  const noopInvestors = mock(async (
    _creditoId: number,
    _pagoId: number,
    _onPersisted?: () => void,
  ) => []) as unknown as ReversePaymentDependencies["reverseInvestors"];

  async function reversarYCapturarResetDelPago(
    payment: Record<string, unknown>,
  ) {
    const recordedUpdates: RecordedUpdate[] = [];
    const { handler } = createPersistenceHarness(
      noopInvestors,
      payment,
      recordedUpdates,
    );

    await handler({
      body: { credito_id: 10, pago_id: 30 },
      set: { status: 0 },
      telemetryLogger: createCarteraStructuredLogger({ sink: () => {} }),
    });

    // El reset de la fila es el único UPDATE sobre pagos_credito que devuelve
    // el pago a `no_required`; el resto de UPDATEs de la reversa van a otras
    // tablas (ajuste_fecha_ideal_pago, creditos, usuarios, cuotas_credito).
    return recordedUpdates.filter(
      (update) =>
        update.table === pagos_credito &&
        update.payload.validationStatus === "no_required",
    );
  }

  test("deja fecha_aplicado en null al resetear una cuota que estaba pagada", async () => {
    const resets = await reversarYCapturarResetDelPago({
      ...pendingPayment,
      pagado: true,
      validationStatus: "validated",
    });

    expect(resets).toHaveLength(1);
    expect(resets[0]?.payload).toMatchObject({
      monto_aplicado: "0",
      fecha_pago: null,
      fecha_aplicado: null,
    });
  });

  test("deja fecha_aplicado en null al resetear el único parcial de la cuota", async () => {
    const resets = await reversarYCapturarResetDelPago(pendingPayment);

    expect(resets).toHaveLength(1);
    expect(resets[0]?.payload).toMatchObject({
      monto_aplicado: "0",
      fecha_pago: null,
      fecha_aplicado: null,
    });
  });
});
