import { tokenDateSchema, type ReviewTransferStatus } from "../nexa/schemas";
import type { CarteraPaymentClient } from "./cartera-client";

export type ApplicationClaim = {
  id: number;
  reference: string;
  amount: number;
  currency: "GTQ" | "USD";
  tokenDate: string;
  tokenIdentifier: string;
  tokenPrefix: string;
  transactionId: string;
  wasReturn: 0 | 1;
  attemptCount: number;
};

export type ApplicationWorkerRepository = {
  claimNextApplication(now: Date, leaseSeconds: number): Promise<ApplicationClaim | null>;
  resolveCreditoId(tokenIdentifier: string, tokenPrefix: string): Promise<number | null>;
  finalizeApplication(id: number, outcome: {
    paymentId: number | null;
    reviewStatus: ReviewTransferStatus;
    failureReason: string | null;
  }, now: Date, attemptCount: number): Promise<void>;
  markApplicationFailed(id: number, reason: string, nextAttemptAt: Date | null, now: Date, attemptCount: number): Promise<void>;
};

export async function runApplicationWorkerOnce(options: {
  repository: ApplicationWorkerRepository;
  cartera: CarteraPaymentClient;
  now?: () => Date;
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: number;
  maxBackoffSeconds: number;
}) {
  const now = options.now?.() ?? new Date();
  const claim = await options.repository.claimNextApplication(now, options.leaseSeconds);
  if (!claim) return false;

  try {
    if (claim.wasReturn === 1) {
      await options.repository.finalizeApplication(claim.id, {
        paymentId: null,
        reviewStatus: "REJECTED",
        failureReason: "returned_transfer",
      }, now, claim.attemptCount);
      return true;
    }

    const creditoId = await options.repository.resolveCreditoId(claim.tokenIdentifier, claim.tokenPrefix);
    if (!creditoId) {
      await options.repository.finalizeApplication(claim.id, {
        paymentId: null,
        reviewStatus: "REJECTED",
        failureReason: "token_user_not_found",
      }, now, claim.attemptCount);
      return true;
    }

    const result = await options.cartera.applyNexaPayment({
      creditoId,
      transaction: {
        reference: claim.reference,
        amount: claim.amount,
        currency: claim.currency,
        tokenDate: tokenDateSchema.parse(claim.tokenDate),
        transactionId: claim.transactionId,
      },
    });
    await options.repository.finalizeApplication(claim.id, result.status === "APPLIED" ? {
      paymentId: result.paymentId,
      reviewStatus: "APPROVED",
      failureReason: null,
    } : {
      paymentId: null,
      reviewStatus: "REJECTED",
      failureReason: safeRejectionReason(result.reason),
    }, now, claim.attemptCount);
  } catch {
    const nextAttemptAt = getNextAttemptAt(
      now,
      claim.attemptCount,
      options.maxAttempts,
      options.backoffSeconds,
      options.maxBackoffSeconds,
    );
    await options.repository.markApplicationFailed(
      claim.id,
      "application_processing_failed",
      nextAttemptAt,
      now,
      claim.attemptCount,
    );
    return true;
  }
  return true;
}

function safeRejectionReason(reason: string) {
  const trimmed = reason.trim().slice(0, 128);
  if (/^[a-z0-9_]{1,64}$/.test(trimmed)) return trimmed;
  return trimmed.match(/\(([a-z0-9_]{1,64})\)$/)?.[1] ?? "cartera_rejected";
}

export function getNextAttemptAt(now: Date, attemptCount: number, maxAttempts: number, backoffSeconds: number, maxBackoffSeconds: number) {
  return attemptCount >= maxAttempts
    ? null
    : new Date(now.getTime() + Math.min(maxBackoffSeconds, backoffSeconds * 2 ** (attemptCount - 1)) * 1_000);
}
