import {
  classifyNexaClaim,
  type NexaClaim,
  type NexaPaymentBody,
  type NexaPaymentContext,
  type StoredNexaEvent,
} from "./nexaPayments";

type QueryClient = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

const storedEvent = (row: Record<string, unknown>): StoredNexaEvent => ({
  id: Number(row.id),
  credito_id: Number(row.credito_id),
  amount: String(row.amount),
  currency: String(row.currency),
  payload_hash: String(row.payload_hash),
  status: String(row.status),
  pago_id: row.pago_id === null ? null : Number(row.pago_id),
});

export async function claimNexaPaymentEvent(
  client: QueryClient,
  body: NexaPaymentBody,
  context: NexaPaymentContext,
): Promise<NexaClaim> {
  const [claimRow] = (await client.query(
    `WITH claimed_nonce AS (
       INSERT INTO cartera.nexa_payment_nonces (nonce)
       VALUES ($2)
       ON CONFLICT DO NOTHING
       RETURNING nonce
     ), inserted_event AS (
       INSERT INTO cartera.nexa_payment_events
         (provider, external_reference, nonce, credito_id, amount, currency, payload_hash, status)
       SELECT 'NEXA', $1, $2, $3, $4, $5, $6, 'processing'
       FROM claimed_nonce
       ON CONFLICT DO NOTHING
       RETURNING id
     )
     SELECT
       EXISTS (SELECT 1 FROM claimed_nonce) AS nonce_claimed,
       (SELECT id FROM inserted_event) AS id`,
    [
      body.externalReference,
      context.nonce,
      body.creditoId,
      body.amount,
      body.currency,
      context.payloadHash,
    ],
  )).rows;
  if (!claimRow?.nonce_claimed) return { kind: "replay" };
  if (claimRow.id != null) {
    return { kind: "new", eventId: Number(claimRow.id) };
  }

  const existing = await client.query(
    `SELECT id, credito_id, amount, currency, payload_hash, status, pago_id
       FROM cartera.nexa_payment_events
      WHERE provider = 'NEXA' AND external_reference = $1
      LIMIT 1`,
    [body.externalReference],
  );
  return classifyNexaClaim(
    existing.rows[0] ? storedEvent(existing.rows[0]) : null,
    false,
    {
      creditoId: body.creditoId,
      amount: body.amount,
      currency: body.currency,
      payloadHash: context.payloadHash,
    },
  );
}
