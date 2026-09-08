import type { ReviewTransferStatus } from "../nexa/schemas";
import { getNextAttemptAt } from "./application-worker";

export type ReviewClaim = {
  id: number;
  paymentTransactionId: number;
  nexaTransactionId: string;
  reference: string;
  status: ReviewTransferStatus;
  attemptCount: number;
};

export type ReviewWorkerRepository = {
  claimNextReview(now: Date, leaseSeconds: number): Promise<ReviewClaim | null>;
  completeReview(claim: ReviewClaim, responsePayload: { reference: number; status: ReviewTransferStatus } | null, now: Date): Promise<void>;
  failReview(claim: ReviewClaim, nextAttemptAt: Date | null, now: Date): Promise<void>;
};

type NexaReviewClient = {
  reviewTransfer(payload: { id: number; reference: number; status: ReviewTransferStatus }): Promise<unknown>;
};

export async function runReviewWorkerOnce(options: {
  repository: ReviewWorkerRepository;
  nexa: NexaReviewClient;
  now?: () => Date;
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: number;
  maxBackoffSeconds: number;
}) {
  const now = options.now?.() ?? new Date();
  const claim = await options.repository.claimNextReview(now, options.leaseSeconds);
  if (!claim) return false;

  try {
    const transactionId = positiveSafeInteger(claim.nexaTransactionId);
    if (transactionId === null) {
      await options.repository.completeReview(claim, null, now);
      return true;
    }
    const reference = positiveSafeInteger(claim.reference);
    if (reference === null) throw new Error("Review reference is not a positive safe integer");
    await options.nexa.reviewTransfer({ id: transactionId, reference, status: claim.status });
    await options.repository.completeReview(claim, { reference, status: claim.status }, now);
  } catch {
    await options.repository.failReview(claim, getNextAttemptAt(
      now,
      claim.attemptCount,
      options.maxAttempts,
      options.backoffSeconds,
      options.maxBackoffSeconds,
    ), now);
  }
  return true;
}

function positiveSafeInteger(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
