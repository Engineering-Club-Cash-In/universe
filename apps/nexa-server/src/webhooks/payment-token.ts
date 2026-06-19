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
}) {
  const router = new Hono();

  router.post("/webhook/v1/payment-token", async (c) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    c.header("X-Nexa-Request-Id", requestId);
    logWebhook(requestId, "received", {
      contentType: c.req.header("Content-Type") ?? null,
      flowId: c.req.header("flowId") ?? null,
      userAgent: c.req.header("User-Agent") ?? null,
    });

    const flowId = c.req.header("flowId");
    const bearerToken = parseAuthorizationToken(c.req.header("Authorization"));
    if (flowId !== deps.flowId || bearerToken !== deps.bearerToken) {
      logWebhook(requestId, "unauthorized", {
        elapsedMs: elapsed(startedAt),
        hasAuthorization: Boolean(c.req.header("Authorization")),
      });
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const rawBody = await c.req.json();
      logWebhook(requestId, "body-received", {
        elapsedMs: elapsed(startedAt),
        keys: typeof rawBody === "object" && rawBody !== null ? Object.keys(rawBody) : [],
      });

      const webhook = paymentTokenWebhookSchema.parse(rawBody);
      const reference = String(webhook.reference);
      const reviewId = toNexaReviewNumber(webhook.id);
      const reviewReference = toNexaReviewNumber(webhook.reference);

      logWebhook(requestId, "parsed", {
        elapsedMs: elapsed(startedAt),
        id: reviewId,
        reference,
        amount: webhook.amount,
        currency: webhook.currency,
        token: maskToken(webhook.token),
      });

      if (!(await deps.transactions.existsByReference(reference))) {
        logWebhook(requestId, "new-reference", { elapsedMs: elapsed(startedAt), reference });
        const transaction = toTokenTransaction(webhook);
        const stored = await deps.transactions.createPending(transaction);
        logWebhook(requestId, "pending-created", { elapsedMs: elapsed(startedAt), reference, transactionId: stored.id });
        const tokenUser = await deps.tokenUsers.findByToken(webhook.token);

        if (!tokenUser) {
          logWebhook(requestId, "token-user-not-found", { elapsedMs: elapsed(startedAt), reference });
          await deps.transactions.markRejected(stored.id, "Token no asociado a credito");
          logWebhook(requestId, "marked-rejected", { elapsedMs: elapsed(startedAt), reference });
          queueReviewTransfer(requestId, deps.nexa, { id: reviewId, reference: reviewReference, status: "REJECTED" });
        } else {
          logWebhook(requestId, "token-user-found", {
            elapsedMs: elapsed(startedAt),
            reference,
            creditoId: tokenUser.creditoId,
          });
          const carteraResult = await deps.cartera.applyNexaPayment({ creditoId: tokenUser.creditoId, transaction });
          logWebhook(requestId, "cartera-result", {
            elapsedMs: elapsed(startedAt),
            reference,
            status: carteraResult.status,
          });
          if (carteraResult.status === "APPLIED") {
            await deps.transactions.markApplied(stored.id, carteraResult.paymentId);
            logWebhook(requestId, "marked-applied", {
              elapsedMs: elapsed(startedAt),
              reference,
              paymentId: carteraResult.paymentId,
            });
            queueReviewTransfer(requestId, deps.nexa, { id: reviewId, reference: reviewReference, status: "APPROVED" });
          } else {
            await deps.transactions.markRejected(stored.id, carteraResult.reason);
            logWebhook(requestId, "marked-rejected", {
              elapsedMs: elapsed(startedAt),
              reference,
              reason: carteraResult.reason,
            });
            queueReviewTransfer(requestId, deps.nexa, { id: reviewId, reference: reviewReference, status: "REJECTED" });
          }
        }
      } else {
        logWebhook(requestId, "duplicate-reference", { elapsedMs: elapsed(startedAt), reference });
      }

      logWebhook(requestId, "responding-ok", { elapsedMs: elapsed(startedAt), reference });
      return c.json({ reference, status: "OK" });
    } catch (error) {
      logWebhook(requestId, "failed", {
        elapsedMs: elapsed(startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  return router;
}

function queueReviewTransfer(
  requestId: string,
  nexa: NexaReviewClient,
  payload: { id: number; reference: number; status: ReviewTransferStatus },
) {
  logWebhook(requestId, "review-queued", payload);
  nexa.reviewTransfer(payload).then((response) => {
    logWebhook(requestId, "review-succeeded", { ...payload, response });
  }).catch((error) => {
    logWebhook(requestId, "review-failed", {
      ...payload,
      error: error instanceof Error ? error.message : String(error),
    });
    // Review failures should not undo local/mock cartera application.
  });
}

function toNexaReviewNumber(value: string | number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Nexa review reference must be numeric: ${value}`);
  }
  return numberValue;
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
    transactionId: "",
  };
}

function elapsed(startedAt: number) {
  return Date.now() - startedAt;
}

function maskToken(token: string) {
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function parseAuthorizationToken(value: string | undefined) {
  return value?.replace(/^Bearer\s+/i, "").trim();
}

function logWebhook(requestId: string, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    scope: "nexa-webhook",
    requestId,
    event,
    ...data,
  });
  console.log(line);
  console.error(line);
}
