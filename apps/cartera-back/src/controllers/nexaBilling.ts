import {
  classifyNexaBillingResponse,
  type NexaBillingOutcome,
} from "./nexaPayments";

// The durable DB fence remains authoritative; this set only identifies work
// still alive in this process. After restart an orphan running fence fails closed.
export function createDeferredNexaBilling(options: {
  run: (eventId: number, paymentIds: number[]) => Promise<NexaBillingOutcome>;
  complete: (eventId: number, paymentId: number) => Promise<void>;
  fail: (eventId: number, status: "billing_failed" | "billing_unknown", code: string) => Promise<void>;
  logError: (error: unknown) => void;
}) {
  const active = new Map<number, Promise<void>>();
  return {
    isRunning: (eventId: number) => active.has(eventId),
    async run(eventId: number, paymentIds: number[]): Promise<NexaBillingOutcome> {
      if (!active.has(eventId)) {
        const task = Promise.resolve().then(async () => {
          try {
            const outcome = await options.run(eventId, paymentIds);
            if (outcome.kind === "billed") await options.complete(eventId, paymentIds[0]!);
            else if (outcome.kind !== "pending") {
              await options.fail(eventId, outcome.kind === "failed" ? "billing_failed" : "billing_unknown", outcome.code);
            }
          } catch {
            // Never retry an ambiguous fiscal mutation automatically.
            await options.fail(eventId, "billing_unknown", "billing_provider_or_persistence_error");
          }
        }).catch(options.logError).finally(() => active.delete(eventId));
        active.set(eventId, task);
      }
      return { kind: "pending", code: "billing_in_progress" };
    },
  };
}

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
