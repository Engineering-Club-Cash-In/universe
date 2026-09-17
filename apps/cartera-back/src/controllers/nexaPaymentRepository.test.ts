import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("0039 vincula cada fila de pago al evento Nexa con FK", () => {
  const migration = readFileSync(
    join(import.meta.dir, "../../drizzle/0039_add_nexa_internal_payments.sql"),
    "utf8",
  );

  expect(migration).toContain("nexa_payment_event_id");
  expect(migration).toContain("REFERENCES cartera.nexa_payment_events(id)");
});

test("claim usa el evento persistente para devolver el paymentId aplicado", async () => {
  const module = await import("./nexaPaymentRepository").catch(() => ({}));
  const claimEvent = Reflect.get(module, "claimNexaPaymentEvent");
  expect(claimEvent).toBeFunction();
  if (typeof claimEvent !== "function") return;

  const responses = [
    { rows: [{ nonce_claimed: true, id: null }] },
    {
      rows: [{
        id: 7,
        credito_id: 10,
        amount: "10.00",
        currency: "GTQ",
        payload_hash: "a".repeat(64),
        status: "applied",
        pago_id: 17,
      }],
    },
  ];
  const query = async () => responses.shift() ?? { rows: [] };

  await expect(
    claimEvent(
      { query },
      { externalReference: "qa-payment-1", creditoId: 10, amount: "10.00", currency: "GTQ" },
      { nonce: "nonce-2", payloadHash: "a".repeat(64), now: new Date() },
    ),
  ).resolves.toEqual({ kind: "applied", paymentId: 17 });
});

test("claim bloquea un reintento cuyo evento quedó en manual_review", async () => {
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  const responses = [
    { rows: [{ nonce_claimed: true, id: null }] },
    {
      rows: [{
        id: 7,
        credito_id: 10,
        amount: "10.00",
        currency: "GTQ",
        payload_hash: "a".repeat(64),
        status: "manual_review",
        pago_id: null,
      }],
    },
  ];

  await expect(claimNexaPaymentEvent(
    { query: async () => responses.shift() ?? { rows: [] } },
    { externalReference: "qa-payment-uncertain", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-retry", payloadHash: "a".repeat(64), now: new Date() },
  )).resolves.toEqual({ kind: "manual_review" });
});

test("claim rechaza en una sola operación un nonce ya consumido", async () => {
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  const queries: string[] = [];

  await expect(claimNexaPaymentEvent(
    {
      query: async (text) => {
        queries.push(text);
        return { rows: [{ nonce_claimed: false, id: null }] };
      },
    },
    { externalReference: "qa-payment-2", creditoId: 10, amount: "10.00", currency: "GTQ" },
    { nonce: "nonce-used", payloadHash: "b".repeat(64), now: new Date() },
  )).resolves.toEqual({ kind: "replay" });
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain("nexa_payment_nonces");
});
