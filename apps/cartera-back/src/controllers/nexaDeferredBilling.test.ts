import { expect, test } from "bun:test";
import { createDeferredNexaBilling } from "./nexaBilling";
import { classifyNexaClaim } from "./nexaPayments";

const event = { id: 1, credito_id: 10, amount: "50.00", currency: "GTQ", payload_hash: "hash", status: "billing_running", pago_id: 99 };
const request = { creditoId: 10, amount: "50.00", currency: "GTQ", payloadHash: "hash" };

test("slow fiscal work returns pending immediately, coalesces retries, and persists completion", async () => {
  const gate = Promise.withResolvers<void>();
  let invoices = 0;
  let completed = 0;
  const errors: unknown[] = [];
  const runner = createDeferredNexaBilling({
    run: async () => { invoices++; await gate.promise; return { kind: "billed" }; },
    complete: async () => { completed++; },
    fail: async () => { throw new Error("unexpected failure"); },
    logError: (e) => errors.push(e),
  });
  for (let i = 0; i < 8; i++) {
    expect(await runner.run(1, [99])).toMatchObject({ kind: "pending" });
    expect(classifyNexaClaim(event, false, request, runner.isRunning(1))).toEqual({ kind: "applied", paymentId: 99, billingStatus: "PENDING" });
  }
  expect(invoices).toBe(1);
  expect(completed).toBe(0);
  expect(classifyNexaClaim(event, false, { ...request, amount: "51.00" }, true).kind).toBe("conflict");
  expect(classifyNexaClaim(event, true, request, true).kind).toBe("replay");
  // A restarted process cannot claim that an abandoned fiscal operation is live.
  expect(classifyNexaClaim(event, false, request, false)).toEqual({ kind: "manual_review", phase: "billing" });
  gate.resolve();
  for (let i = 0; i < 100 && runner.isRunning(1); i++) await Bun.sleep(1);
  expect(runner.isRunning(1)).toBe(false);
  expect(completed).toBe(1);
  expect(errors).toEqual([]);
});

test("background provider/persistence failure is fenced unknown, not an unhandled rejection", async () => {
  const failed: string[] = [];
  const errors: unknown[] = [];
  const runner = createDeferredNexaBilling({
    run: async () => { throw new Error("provider outcome uncertain"); },
    complete: async () => {},
    fail: async (_id, status) => { failed.push(status); },
    logError: (e) => errors.push(e),
  });
  expect(await runner.run(1, [99])).toMatchObject({ kind: "pending" });
  for (let i = 0; i < 100 && runner.isRunning(1); i++) await Bun.sleep(1);
  expect(failed).toEqual(["billing_unknown"]);
  expect(errors).toEqual([]);
  expect(classifyNexaClaim({ ...event, status: "billing_unknown" }, false, request, true)).toEqual({ kind: "manual_review", phase: "billing" });
});
