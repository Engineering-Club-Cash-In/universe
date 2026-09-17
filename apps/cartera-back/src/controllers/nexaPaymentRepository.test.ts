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
      { externalReference: "qa-payment-1", creditoId: 10, amount: "10.00", currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z" },
      { nonce: "nonce-2", payloadHash: "a".repeat(64), now: new Date() },
    ),
  ).resolves.toEqual({ kind: "applied", paymentId: 17 });
});

test("new client replays a legacy-body applied event by stable compatibility fingerprint", async () => {
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  const legacyHash = "a".repeat(64);
  const semanticFingerprint = "s".repeat(64);
  const insertedFingerprints: unknown[] = [];
  const responses = [
    { rows: [{ nonce_claimed: true, id: null }] },
    {
      rows: [{
        id: 7,
        credito_id: 10,
        amount: "10.00",
        currency: "GTQ",
        payload_hash: legacyHash,
        status: "applied",
        pago_id: 17,
      }],
    },
  ];

  await expect(claimNexaPaymentEvent(
    {
      query: async (_text, values) => {
        if (values?.length === 6) insertedFingerprints.push(values[5]);
        return responses.shift() ?? { rows: [] };
      },
    },
    { externalReference: "qa-payment-legacy", creditoId: 10, amount: "10.00", currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z" },
    {
      nonce: "nonce-new-client",
      payloadHash: "b".repeat(64),
      eventFingerprint: semanticFingerprint,
      legacyPayloadHash: legacyHash,
      now: new Date(),
    },
  )).resolves.toEqual({ kind: "applied", paymentId: 17 });
  expect(insertedFingerprints).toEqual([semanticFingerprint]);
});

test("legacy failed event upgrades to the dated fingerprint before retry", async () => {
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  const legacyHash = "a".repeat(64);
  const datedFingerprint = "d".repeat(64);
  const updates: Array<{ text: string; values?: unknown[] }> = [];
  const responses = [
    { rows: [{ nonce_claimed: true, id: null }] },
    {
      rows: [{
        id: 7,
        credito_id: 10,
        amount: "10.00",
        currency: "GTQ",
        payload_hash: legacyHash,
        status: "failed",
        pago_id: null,
      }],
    },
    { rows: [{ id: 7 }] },
  ];

  await expect(claimNexaPaymentEvent(
    {
      query: async (text, values) => {
        if (text.includes("UPDATE cartera.nexa_payment_events")) updates.push({ text, values });
        return responses.shift() ?? { rows: [] };
      },
    },
    { externalReference: "qa-payment-upgrade", creditoId: 10, amount: "10.00", currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z" },
    {
      nonce: "nonce-upgrade",
      payloadHash: "b".repeat(64),
      eventFingerprint: datedFingerprint,
      legacyPayloadHash: legacyHash,
      now: new Date(),
    },
  )).resolves.toEqual({ kind: "retry", eventId: 7 });
  expect(updates).toHaveLength(1);
  expect(updates[0]?.text).toContain("payload_hash = $2");
  expect(updates[0]?.values).toEqual([7, datedFingerprint]);
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
    { externalReference: "qa-payment-uncertain", creditoId: 10, amount: "10.00", currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z" },
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
    { externalReference: "qa-payment-2", creditoId: 10, amount: "10.00", currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z" },
    { nonce: "nonce-used", payloadHash: "b".repeat(64), now: new Date() },
  )).resolves.toEqual({ kind: "replay" });
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain("nexa_payment_nonces");
});
