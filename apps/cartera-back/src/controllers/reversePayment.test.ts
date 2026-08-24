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

const { reversePayment } = await import("./reversePayment");
const { createCarteraStructuredLogger } = await import("../utils/structuredLogger");
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
