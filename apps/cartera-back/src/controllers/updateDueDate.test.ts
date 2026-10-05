import { describe, expect, test } from "bun:test";

const syntheticEnvironment = {
  SUPABASE_DB_URL: "postgresql://127.0.0.1:1/synthetic",
  RESEND_API_KEY: "synthetic-test-key",
  EMAIL_DOMAIN: "example.invalid",
} as const;
const previousEnvironment = Object.fromEntries(
  Object.keys(syntheticEnvironment).map((key) => [key, process.env[key]]),
) as Record<keyof typeof syntheticEnvironment, string | undefined>;
Object.assign(process.env, syntheticEnvironment);

const {
  calcularFechaPorNumeroCuota,
  cambiarFechaInicio,
  classifyDueDateBatchTerminal,
  classifyDueDatePersistenceFailure,
  updateDueDates,
  updateSingleDueDate,
} = await import("./updateDueDate");
const { createCarteraStructuredLogger } = await import("../utils/structuredLogger");
for (const key of Object.keys(syntheticEnvironment) as Array<keyof typeof syntheticEnvironment>) {
  const previous = previousEnvironment[key];
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

describe("due-date historical contracts", () => {
  test("preserves installment-number month offsets and end-of-month clamping", () => {
    expect(calcularFechaPorNumeroCuota({ anio: 2025, mes: 1 }, 5, 6, 31)).toBe("2025-02-28");
    expect(calcularFechaPorNumeroCuota({ anio: 2025, mes: 1 }, 5, 17, 31)).toBe("2026-01-31");
    expect(calcularFechaPorNumeroCuota({ anio: 2024, mes: 1 }, 1, 2, 31)).toBe("2024-02-29");
  });

  test("batch validation remains HTTP 400 with its historical body", async () => {
    const set = { status: 0 };
    const result = await updateDueDates({ body: { creditos: [] }, set });
    expect(set.status).toBe(400);
    expect(result).toEqual(expect.objectContaining({ message: "Validation failed", errors: expect.any(Object) }));
  });

  test("single validation remains HTTP 400 without delegating", async () => {
    const set = { status: 0 };
    const result = await updateSingleDueDate({ body: { numero_credito_sifco: "", dia_pago: 32 }, set });
    expect(set.status).toBe(400);
    expect(result).toEqual(expect.objectContaining({ message: "Validation failed", errors: expect.any(Object) }));
  });

  test("start-date validation preserves success false and HTTP 400", async () => {
    const set = { status: 0 };
    const result = await cambiarFechaInicio({ body: {}, set });
    expect(set.status).toBe(400);
    expect(result).toEqual(expect.objectContaining({ success: false, message: "Validation failed", errors: expect.any(Object) }));
  });

  test("a failed Date.now does not alter validation response or status", async () => {
    const originalNow = Date.now;
    Date.now = () => { throw new Error("synthetic clock failure"); };
    try {
      const set = { status: 0 };
      const result = await updateDueDates({ body: null, set });
      expect(set.status).toBe(400);
      expect(result).toEqual(expect.objectContaining({ message: "Validation failed" }));
    } finally {
      Date.now = originalNow;
    }
  });

  test("a transient clock failure still emits a bounded terminal", async () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: "staging",
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      sink: (line) => lines.push(line),
    });
    const originalNow = Date.now;
    let calls = 0;
    Date.now = () => {
      calls += 1;
      if (calls === 1) throw new Error("synthetic transient clock failure");
      return originalNow();
    };
    try {
      const set = { status: 0 };
      const result = await updateDueDates({ body: null, set, telemetryLogger: logger });
      expect(set.status).toBe(400);
      expect(result).toEqual(expect.objectContaining({ message: "Validation failed" }));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toEqual(expect.objectContaining({
        event: "credit.due_date",
        outcome: "rejected",
        duration_ms: 86_400_000,
      }));
    } finally {
      Date.now = originalNow;
    }
  });

  test("all-skipped February delegation preserves HTTP 400 and emits exact safe counts", async () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: "staging",
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      sink: (line) => lines.push(line),
    });
    const set = { status: 0 };
    const result = await updateDueDates({
      body: { creditos: [] },
      set,
      telemetryOperation: "repair_missing_february",
      telemetryProcessedCount: 2,
      telemetrySkippedCount: 2,
      telemetryLogger: logger,
    });
    expect(set.status).toBe(400);
    expect(result).toEqual(expect.objectContaining({ message: "Validation failed" }));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(expect.objectContaining({
      event: "credit.due_date",
      outcome: "skipped",
      due_date_operation: "repair_missing_february",
      processed_count: 2,
      succeeded_count: 0,
      failed_count: 0,
      skipped_count: 2,
      reason_code: "missing_payment_reference",
    }));
  });
});

describe("due-date terminal classification", () => {
  test("classifies swallowed item failures as one partial batch terminal", () => {
    expect(classifyDueDateBatchTerminal({
      operation: "batch_update",
      processedCount: 3,
      succeededCount: 2,
      failedCount: 1,
      skippedCount: 0,
    })).toEqual({
      outcome: "partially_completed",
      operation: "batch_update",
      processedCount: 3,
      succeededCount: 2,
      failedCount: 1,
      skippedCount: 0,
      reasonCode: "item_failures",
    });
  });

  test("keeps wrapper operation and silent omissions in a truthful invariant", () => {
    expect(classifyDueDateBatchTerminal({
      operation: "repair_missing_february",
      processedCount: 5,
      succeededCount: 3,
      failedCount: 0,
      skippedCount: 2,
    })).toEqual({
      outcome: "completed",
      operation: "repair_missing_february",
      processedCount: 5,
      succeededCount: 3,
      failedCount: 0,
      skippedCount: 2,
    });
  });

  test("preserves single-update identity without a second batch terminal", () => {
    expect(classifyDueDateBatchTerminal({
      operation: "single_update",
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
    }).operation).toBe("single_update");
  });

  test("classifies all discovered February candidates without payment reference as skipped", () => {
    expect(classifyDueDateBatchTerminal({
      operation: "repair_missing_february",
      processedCount: 2,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 2,
    })).toEqual({
      outcome: "skipped",
      operation: "repair_missing_february",
      processedCount: 2,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 2,
      reasonCode: "missing_payment_reference",
    });
  });

  test("distinguishes pre-write failures from confirmed partial persistence", () => {
    expect(classifyDueDatePersistenceFailure("change_start_date", false)).toEqual({
      outcome: "failed",
      operation: "change_start_date",
      errorCode: "unknown",
    });
    expect(classifyDueDatePersistenceFailure("json_bulk_update", true)).toEqual({
      outcome: "partially_persisted",
      operation: "json_bulk_update",
      errorCode: "unknown",
    });
  });
});
