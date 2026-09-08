import { Hono } from "hono";
import { paymentTokenWebhookSchema, type ReviewTransferStatus, type TokenTransaction } from "../nexa/schemas";
import type { CarteraPaymentClient } from "../payments/cartera-client";
import type { PaymentTransactionRepository, TokenUserRepository } from "../payments/repositories";

interface NexaReviewClient {
  reviewTransfer(payload: { id: number; reference: number; status: ReviewTransferStatus }): Promise<unknown>;
}

export function createPaymentTokenWebhookRouter(deps: {
  flowId: string;
  bearerToken: string;
  nexa: NexaReviewClient;
  cartera: CarteraPaymentClient;
  transactions: PaymentTransactionRepository;
  tokenUsers: TokenUserRepository;
  logInfo?: (message: string) => void;
}) {
  const router = new Hono();
  const logInfo = deps.logInfo ?? console.log;

  router.post("/webhook/v1/payment-token", async (c) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    c.header("X-Nexa-Request-Id", requestId);
    logWebhook(logInfo, requestId, "received", {
      contentType: c.req.header("Content-Type") ?? null,
    });

    const flowId = c.req.header("flowId");
    const bearerToken = parseAuthorizationToken(c.req.header("Authorization"));
    if (flowId !== deps.flowId || bearerToken !== deps.bearerToken) {
      logWebhook(logInfo, requestId, "unauthorized", {
        elapsedMs: elapsed(startedAt),
        hasAuthorization: Boolean(c.req.header("Authorization")),
      });
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const rawBody = await c.req.json();
      logWebhook(logInfo, requestId, "body-received", {
        elapsedMs: elapsed(startedAt),
        keys: typeof rawBody === "object" && rawBody !== null ? Object.keys(rawBody) : [],
      });

      const webhook = paymentTokenWebhookSchema.parse(rawBody);
      const reference = String(webhook.reference);

      logWebhook(logInfo, requestId, "parsed", {
        elapsedMs: elapsed(startedAt),
        currency: webhook.currency,
      });

      const stored = await deps.transactions.upsertReceived(toTokenTransaction(webhook));
      logWebhook(logInfo, requestId, stored.created ? "received-created" : "received-existing", { elapsedMs: elapsed(startedAt) });

      logWebhook(logInfo, requestId, "responding-ok", { elapsedMs: elapsed(startedAt) });
      return c.json({ reference, status: "OK" });
    } catch (error) {
      logWebhook(logInfo, requestId, "failed", {
        elapsedMs: elapsed(startedAt),
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  });

  return router;
}

function toTokenTransaction(webhook: ReturnType<typeof paymentTokenWebhookSchema.parse>): TokenTransaction {
  return {
    reference: String(webhook.reference),
    amount: webhook.amount,
    bank: webhook.originBank,
    comments: webhook.comments ?? "",
    currency: webhook.currency,
    account: webhook.originAccount,
    token: webhook.token,
    tokenDate: new Date().toISOString(),
    tokenIdentifier: webhook.token.slice(-9),
    tokenName: webhook.originAccountName ?? "Webhook Nexa",
    tokenPrefix: webhook.token.slice(0, 7),
    wasReturn: 0,
    transactionId: String(webhook.id),
  };
}

function elapsed(startedAt: number) {
  return Date.now() - startedAt;
}


function parseAuthorizationToken(value: string | undefined) {
  return value?.replace(/^Bearer\s+/i, "").trim();
}

function logWebhook(logInfo: (message: string) => void, requestId: string, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    scope: "nexa-webhook",
    requestId,
    event,
    ...data,
  });
  logInfo(line);
}
