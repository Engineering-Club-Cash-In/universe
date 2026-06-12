import { Hono } from "hono";
import { paymentTokenWebhookSchema, type ReviewTransferStatus, type TokenTransaction } from "../nexa/schemas";
import type { CarteraPaymentClient } from "../payments/cartera-client";
import type { PaymentTransactionRepository, TokenUserRepository } from "../payments/repositories";

interface NexaReviewClient {
  reviewTransfer(payload: { id: string; reference: string | number; status: ReviewTransferStatus }): Promise<unknown>;
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
    const flowId = c.req.header("flowId");
    const bearerToken = c.req.header("Authorization")?.replace("Bearer ", "").trim();
    if (flowId !== deps.flowId || bearerToken !== deps.bearerToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const webhook = paymentTokenWebhookSchema.parse(await c.req.json());
    const reference = String(webhook.reference);
    const reviewReference = toNexaReviewNumber(webhook.reference);

    if (!(await deps.transactions.existsByReference(reference))) {
      const transaction = toTokenTransaction(webhook);
      const stored = await deps.transactions.createPending(transaction);
      const tokenUser = await deps.tokenUsers.findByToken(webhook.token);

      if (!tokenUser) {
        await deps.transactions.markRejected(stored.id, "Token no asociado a credito");
        await safeReviewTransfer(deps.nexa, { id: String(webhook.id), reference: reviewReference, status: "REJECTED" });
      } else {
        const carteraResult = await deps.cartera.applyNexaPayment({ creditoId: tokenUser.creditoId, transaction });
        if (carteraResult.status === "APPLIED") {
          await deps.transactions.markApplied(stored.id, carteraResult.paymentId);
          await safeReviewTransfer(deps.nexa, { id: String(webhook.id), reference: reviewReference, status: "APPROVED" });
        } else {
          await deps.transactions.markRejected(stored.id, carteraResult.reason);
          await safeReviewTransfer(deps.nexa, { id: String(webhook.id), reference: reviewReference, status: "REJECTED" });
        }
      }
    }

    return c.json({ reference, status: "OK" });
  });

  return router;
}

async function safeReviewTransfer(
  nexa: NexaReviewClient,
  payload: { id: string; reference: number; status: ReviewTransferStatus },
) {
  try {
    await nexa.reviewTransfer(payload);
  } catch (error) {
    // Review failures should not undo local/mock cartera application.
  }
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
