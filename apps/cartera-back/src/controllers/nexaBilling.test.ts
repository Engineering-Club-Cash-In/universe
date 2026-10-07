import { expect, test } from "bun:test";

test("disabled billing stays pending without touching fiscal code", async () => {
  const module = await import("./nexaBilling").catch(() => ({}));
  const run = Reflect.get(module, "runNexaBilling");
  expect(run).toBeFunction();
  if (typeof run !== "function") return;

  let touched = false;
  await expect(run({
    enabled: false,
    eventId: 7,
    paymentIds: [17],
    start: async () => { touched = true; return true; },
    invoice: async () => { touched = true; return { status: 200, response: { success: true, data: {} } }; },
  })).resolves.toEqual({ kind: "pending", code: "billing_not_enabled" });
  expect(touched).toBe(false);
});

test("persists billing_running before invoicing every linked payment", async () => {
  const { runNexaBilling } = await import("./nexaBilling");
  const calls: string[] = [];

  await expect(runNexaBilling({
    enabled: true,
    eventId: 7,
    paymentIds: [17, 18],
    start: async (eventId) => { calls.push(`start:${eventId}`); return true; },
    invoice: async (paymentId) => {
      calls.push(`invoice:${paymentId}`);
      return {
        status: 200,
        response: { success: true, data: { pago_id: paymentId, total_facturas: 0, facturas: [], errores: undefined } },
      };
    },
  })).resolves.toEqual({ kind: "billed" });
  expect(calls).toEqual(["start:7", "invoice:17", "invoice:18"]);
});

test("a concurrent or stale billing claim fails closed before provider calls", async () => {
  const { runNexaBilling } = await import("./nexaBilling");
  let invoiced = false;

  await expect(runNexaBilling({
    enabled: true,
    eventId: 7,
    paymentIds: [17],
    start: async () => false,
    invoice: async () => { invoiced = true; return { status: 200, response: {} }; },
  })).resolves.toEqual({ kind: "unknown", code: "billing_state_conflict" });
  expect(invoiced).toBe(false);
});

test("a payment deleted by CAIDO stays pending, never unknown, and never reaches the provider", async () => {
  const { runNexaBilling } = await import("./nexaBilling");
  let invoiced = false;

  await expect(runNexaBilling({
    enabled: true,
    eventId: 7,
    paymentIds: [17],
    start: async () => "payment_deleted",
    invoice: async () => { invoiced = true; return { status: 200, response: {} }; },
  })).resolves.toEqual({ kind: "pending", code: "billing_payment_deleted" });
  expect(invoiced).toBe(false);
});

test("a later definitive rejection is unknown after an earlier row was billed", async () => {
  const { runNexaBilling } = await import("./nexaBilling");
  const invoiced: number[] = [];

  await expect(runNexaBilling({
    enabled: true,
    eventId: 7,
    paymentIds: [17, 18],
    start: async () => true,
    invoice: async (paymentId) => {
      invoiced.push(paymentId);
      return paymentId === 17
        ? {
            status: 200,
            response: { success: true, data: { total_facturas: 1, facturas: [{ factura_id: 91 }] } },
          }
        : { status: 404, response: { success: false, error: "billing rejected" } };
    },
  })).resolves.toEqual({ kind: "unknown", code: "partial_billing_result" });
  expect(invoiced).toEqual([17, 18]);
});

test("partial provider results stop the batch as unknown", async () => {
  const { runNexaBilling } = await import("./nexaBilling");
  const invoiced: number[] = [];

  await expect(runNexaBilling({
    enabled: true,
    eventId: 7,
    paymentIds: [17, 18],
    start: async () => true,
    invoice: async (paymentId) => {
      invoiced.push(paymentId);
      return paymentId === 17
        ? {
            status: 200,
            response: { success: true, data: { facturas: [], errores: [{ error: "ambiguous" }] } },
          }
        : { status: 200, response: { success: true, data: { facturas: [] } } };
    },
  })).resolves.toEqual({ kind: "unknown", code: "partial_billing_result" });
  expect(invoiced).toEqual([17]);
});
