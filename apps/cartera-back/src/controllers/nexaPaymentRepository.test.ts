import { expect, test } from "bun:test";

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
