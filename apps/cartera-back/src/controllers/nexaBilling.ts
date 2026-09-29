import {
  classifyNexaBillingResponse,
  type NexaBillingOutcome,
} from "./nexaPayments";

export async function runNexaBilling({
  enabled,
  eventId,
  paymentIds,
  start,
  invoice,
}: {
  enabled: boolean;
  eventId: number;
  paymentIds: number[];
  start: (eventId: number) => Promise<boolean>;
  invoice: (paymentId: number) => Promise<{ status: number; response: unknown }>;
}): Promise<NexaBillingOutcome> {
  if (!enabled) return { kind: "pending", code: "billing_not_enabled" };
  if (!await start(eventId)) {
    return { kind: "unknown", code: "billing_state_conflict" };
  }
  let billedAny = false;
  for (const paymentId of paymentIds) {
    const { status, response } = await invoice(paymentId);
    const outcome = classifyNexaBillingResponse(status, response);
    if (outcome.kind !== "billed") {
      return billedAny && outcome.kind === "failed"
        ? { kind: "unknown", code: "partial_billing_result" }
        : outcome;
    }
    billedAny = true;
  }
  return { kind: "billed" };
}
