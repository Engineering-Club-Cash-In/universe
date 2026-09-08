import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { TokenTransaction } from "../nexa/schemas";
import type { ApplicationClaim } from "../payments/application-worker";
import type { MockCreditLedger } from "../payments/mock-ledger";
import type { ReviewClaim, ReviewWorkerRepository } from "../payments/review-worker";
import type { PaymentTransactionRepository, TokenUserRepository } from "../payments/repositories";
import type { TokenUserCreationRepository } from "../tokens/service";
import type { NexaDb } from "./index";
import { mockCarteraCredits, nexaPaymentTokens, nexaPaymentTransactions, nexaPollRuns, nexaReviews, nexaTokenUsers } from "./schema";

export class PaymentTokenRepository {
  constructor(private readonly db: NexaDb) {}

  async findActive() {
    const [token] = await this.db.select().from(nexaPaymentTokens).where(eq(nexaPaymentTokens.active, true)).limit(1);
    return token ?? null;
  }

  async create(input: { nexaTokenId: number; prefix: string; account: string; name: string }) {
    const [token] = await this.db.insert(nexaPaymentTokens).values(input).returning();
    return token;
  }
}

export class DbTokenUserRepository implements TokenUserRepository, TokenUserCreationRepository {
  constructor(private readonly db: NexaDb) {}

  async nextIdentifierSequence() {
    const result = await this.db.execute(sql<{ value: string }>`select nextval('nexa_token_identifier_seq')::text as value`);
    return Number(result.rows[0]?.value);
  }

  async createTokenUser(user: {
    paymentTokenId: number;
    creditoId: number;
    identifier: string;
    description: string;
    nationalId: string;
    nexaUserId: number;
    token: string;
  }) {
    const [created] = await this.db.insert(nexaTokenUsers).values(user).returning();
    return created;
  }

  async findByToken(token: string) {
    const [user] = await this.db.select().from(nexaTokenUsers).where(eq(nexaTokenUsers.token, token)).limit(1);
    return user ? { creditoId: user.creditoId } : null;
  }

  async list() {
    return this.db.select().from(nexaTokenUsers).orderBy(nexaTokenUsers.id);
  }
}

export class DbPaymentTransactionRepository implements PaymentTransactionRepository {
  constructor(private readonly db: NexaDb) {}

  async upsertReceived(transaction: TokenTransaction) {
    const reference = String(transaction.reference);
    const payloadFingerprint = fingerprint(reference, transaction.amount, transaction.token, transaction.transactionId);
    const sanitizedPayload = {
      reference,
      amount: transaction.amount,
      currency: transaction.currency,
      tokenDate: transaction.tokenDate,
      tokenIdentifier: transaction.tokenIdentifier,
      tokenPrefix: transaction.tokenPrefix,
      wasReturn: transaction.wasReturn,
      transactionId: transaction.transactionId,
    };
    const [stored] = await this.db.insert(nexaPaymentTransactions).values({
      reference,
      amount: String(transaction.amount),
      bank: "",
      comments: "",
      currency: transaction.currency,
      account: "",
      token: "",
      tokenDate: transaction.tokenDate,
      tokenIdentifier: transaction.tokenIdentifier,
      tokenName: "",
      tokenPrefix: transaction.tokenPrefix,
      wasReturn: transaction.wasReturn,
      transactionId: transaction.transactionId,
      rawPayload: sanitizedPayload,
      payloadFingerprint,
    }).onConflictDoUpdate({
      target: nexaPaymentTransactions.reference,
      set: { reference: sql`excluded.reference` },
    }).returning({
      id: nexaPaymentTransactions.id,
      reference: nexaPaymentTransactions.reference,
      amount: nexaPaymentTransactions.amount,
      token: nexaPaymentTransactions.token,
      transactionId: nexaPaymentTransactions.transactionId,
      processingStatus: nexaPaymentTransactions.processingStatus,
      payloadFingerprint: nexaPaymentTransactions.payloadFingerprint,
      created: sql<boolean>`xmax = 0`,
    });

    const storedFingerprint = stored.payloadFingerprint
      ?? (stored.token ? fingerprint(stored.reference, Number(stored.amount), stored.token, stored.transactionId) : null);
    if (storedFingerprint !== payloadFingerprint) {
      throw new Error(`Incompatible replay for reference ${reference}`);
    }

    return {
      id: stored.id,
      reference: stored.reference,
      processingStatus: stored.processingStatus,
      created: stored.created,
    };
  }

  async markApplied(id: number, paymentId: number) {
    await this.db.update(nexaPaymentTransactions).set({ processingStatus: "APPLIED", carteraPaymentId: paymentId, updatedAt: new Date() }).where(eq(nexaPaymentTransactions.id, id));
  }

  async markRejected(id: number, reason: string) {
    await this.db.update(nexaPaymentTransactions).set({ processingStatus: "REJECTED", failureReason: reason, updatedAt: new Date() }).where(eq(nexaPaymentTransactions.id, id));
  }

  async markFailed(id: number, reason: string) {
    await this.db.update(nexaPaymentTransactions).set({ processingStatus: "FAILED", failureReason: reason, updatedAt: new Date() }).where(eq(nexaPaymentTransactions.id, id));
  }

  async claimNextApplication(now: Date, leaseSeconds: number): Promise<ApplicationClaim | null> {
    const result = await this.db.execute(sql<ApplicationClaim>`
      WITH candidate AS (
        SELECT id
        FROM nexa_payment_transactions
        WHERE processing_status = 'RECEIVED'
          OR (processing_status = 'FAILED' AND next_attempt_at <= ${now})
          OR (processing_status = 'APPLYING' AND lease_until <= ${now})
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE nexa_payment_transactions AS payment
      SET processing_status = 'APPLYING',
          attempt_count = payment.attempt_count + 1,
          last_attempt_at = ${now},
          lease_until = ${now}::timestamptz + ${leaseSeconds} * INTERVAL '1 second',
          next_attempt_at = NULL,
          failure_reason = NULL,
          updated_at = ${now}
      FROM candidate
      WHERE payment.id = candidate.id
      RETURNING payment.id,
        payment.reference,
        payment.amount,
        payment.currency,
        payment.token_identifier AS "tokenIdentifier",
        payment.token_prefix AS "tokenPrefix",
        payment.transaction_id AS "transactionId",
        payment.attempt_count AS "attemptCount"
    `);
    const row = result.rows[0];
    return row ? {
      id: Number(row.id),
      reference: String(row.reference),
      amount: Number(row.amount),
      currency: paymentCurrency(row.currency),
      tokenIdentifier: String(row.tokenIdentifier),
      tokenPrefix: String(row.tokenPrefix),
      transactionId: String(row.transactionId),
      attemptCount: Number(row.attemptCount),
    } : null;
  }

  async resolveCreditoId(tokenIdentifier: string, tokenPrefix: string) {
    const [user] = await this.db.select({ creditoId: nexaTokenUsers.creditoId })
      .from(nexaTokenUsers)
      .innerJoin(nexaPaymentTokens, eq(nexaTokenUsers.paymentTokenId, nexaPaymentTokens.id))
      .where(and(
        eq(nexaTokenUsers.identifier, tokenIdentifier),
        eq(nexaPaymentTokens.prefix, tokenPrefix),
        eq(nexaTokenUsers.active, true),
        eq(nexaPaymentTokens.active, true),
      ))
      .limit(1);
    return user?.creditoId ?? null;
  }

  async finalizeApplication(id: number, outcome: {
    paymentId: number | null;
    reviewStatus: "APPROVED" | "REJECTED";
    failureReason: string | null;
  }, now: Date) {
    await this.db.transaction(async (tx) => {
      const [payment] = await tx.update(nexaPaymentTransactions).set({
        processingStatus: "REVIEW_PENDING",
        carteraPaymentId: outcome.paymentId,
        failureReason: outcome.failureReason,
        nextAttemptAt: null,
        leaseUntil: null,
        updatedAt: now,
      }).where(eq(nexaPaymentTransactions.id, id)).returning({
        reference: nexaPaymentTransactions.reference,
      });
      if (!payment) throw new Error("Application payment not found");
      await tx.insert(nexaReviews).values({
        transactionId: id,
        reference: payment.reference,
        status: outcome.reviewStatus,
        requestPayload: { reference: payment.reference, status: outcome.reviewStatus },
        attempts: 0,
        nextAttemptAt: now,
      }).onConflictDoNothing({ target: nexaReviews.transactionId });
    });
  }

  async markApplicationFailed(id: number, reason: string, nextAttemptAt: Date | null, now: Date) {
    await this.db.update(nexaPaymentTransactions).set({
      processingStatus: nextAttemptAt ? "FAILED" : "MANUAL_REVIEW",
      failureReason: reason,
      nextAttemptAt,
      leaseUntil: null,
      updatedAt: now,
    }).where(eq(nexaPaymentTransactions.id, id));
  }

  async list() {
    return this.db.select().from(nexaPaymentTransactions).orderBy(nexaPaymentTransactions.id);
  }
}

export class DbReviewRepository implements ReviewWorkerRepository {
  constructor(private readonly db: NexaDb) {}

  async claimNextReview(now: Date, leaseSeconds: number): Promise<ReviewClaim | null> {
    const result = await this.db.execute(sql<ReviewClaim>`
      WITH candidate AS (
        SELECT review.id,
          payment.id AS payment_transaction_id,
          payment.transaction_id AS nexa_transaction_id,
          payment.reference,
          review.status
        FROM nexa_reviews AS review
        INNER JOIN nexa_payment_transactions AS payment ON payment.id = review.transaction_id
        WHERE review.completed_at IS NULL
          AND (review.next_attempt_at IS NULL OR review.next_attempt_at <= ${now})
          AND (review.lease_until IS NULL OR review.lease_until <= ${now})
        ORDER BY review.created_at, review.id
        FOR UPDATE OF review SKIP LOCKED
        LIMIT 1
      )
      UPDATE nexa_reviews AS review
      SET attempts = review.attempts + 1,
          lease_until = ${now}::timestamptz + ${leaseSeconds} * INTERVAL '1 second',
          next_attempt_at = NULL,
          updated_at = ${now}
      FROM candidate
      WHERE review.id = candidate.id
      RETURNING review.id,
        candidate.payment_transaction_id AS "paymentTransactionId",
        candidate.nexa_transaction_id AS "nexaTransactionId",
        candidate.reference,
        candidate.status,
        review.attempts AS "attemptCount"
    `);
    const row = result.rows[0];
    return row ? {
      id: Number(row.id),
      paymentTransactionId: Number(row.paymentTransactionId),
      nexaTransactionId: String(row.nexaTransactionId),
      reference: String(row.reference),
      status: storedReviewStatus(row.status),
      attemptCount: Number(row.attemptCount),
    } : null;
  }

  async completeReview(claim: ReviewClaim, responsePayload: { reference: number; status: "APPROVED" | "REJECTED" } | null, now: Date) {
    await this.db.transaction(async (tx) => {
      await tx.update(nexaReviews).set({
        responsePayload,
        lastError: null,
        nextAttemptAt: null,
        leaseUntil: null,
        completedAt: now,
        updatedAt: now,
      }).where(eq(nexaReviews.id, claim.id));
      await tx.update(nexaPaymentTransactions).set({
        processingStatus: "COMPLETED",
        updatedAt: now,
      }).where(eq(nexaPaymentTransactions.id, claim.paymentTransactionId));
    });
  }

  async failReview(claim: ReviewClaim, nextAttemptAt: Date | null, now: Date) {
    await this.db.transaction(async (tx) => {
      await tx.update(nexaReviews).set({
        lastError: "review_processing_failed",
        nextAttemptAt,
        leaseUntil: null,
        completedAt: nextAttemptAt ? null : now,
        updatedAt: now,
      }).where(eq(nexaReviews.id, claim.id));
      await tx.update(nexaPaymentTransactions).set({
        processingStatus: nextAttemptAt ? "REVIEW_PENDING" : "MANUAL_REVIEW",
        updatedAt: now,
      }).where(eq(nexaPaymentTransactions.id, claim.paymentTransactionId));
    });
  }
}

function fingerprint(reference: string, amount: number, token: string, transactionId: string) {
  return createHash("sha256").update(JSON.stringify([reference, amount, token, transactionId])).digest("hex");
}

function paymentCurrency(value: unknown): "GTQ" | "USD" {
  if (value !== "GTQ" && value !== "USD") throw new Error("Stored payment currency is invalid");
  return value;
}

function storedReviewStatus(value: unknown): "APPROVED" | "REJECTED" {
  if (value !== "APPROVED" && value !== "REJECTED") throw new Error("Stored review status is invalid");
  return value;
}

export class PollRunRepository {
  constructor(private readonly db: NexaDb) {}

  async run<T>(date: string, callback: () => Promise<T & { found: number; created: number; applied: number; rejected: number; skipped: number; failed: number }>) {
    const [run] = await this.db.insert(nexaPollRuns).values({ date, status: "RUNNING" }).returning();
    try {
      const result = await callback();
      await this.db.update(nexaPollRuns).set({
        status: "COMPLETED",
        transactionsFound: result.found,
        transactionsCreated: result.created,
        transactionsApplied: result.applied,
        transactionsRejected: result.rejected,
        transactionsSkipped: result.skipped,
        transactionsFailed: result.failed,
        finishedAt: new Date(),
      }).where(eq(nexaPollRuns.id, run.id));
      return result;
    } catch (error) {
      await this.db.update(nexaPollRuns).set({ status: "FAILED", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() }).where(eq(nexaPollRuns.id, run.id));
      throw error;
    }
  }
}

export class MockCreditRepository implements MockCreditLedger {
  constructor(private readonly db: NexaDb) {}

  async upsert(input: { creditoId: number; borrowerName: string; initialBalance: number; installmentAmount: number }) {
    const values = {
      creditoId: input.creditoId,
      borrowerName: input.borrowerName,
      initialBalance: String(input.initialBalance),
      currentBalance: String(input.initialBalance),
      installmentAmount: String(input.installmentAmount),
      totalPaid: "0",
      updatedAt: new Date(),
    };
    const [credit] = await this.db
      .insert(mockCarteraCredits)
      .values(values)
      .onConflictDoUpdate({ target: mockCarteraCredits.creditoId, set: values })
      .returning();
    return credit;
  }

  async list() {
    return this.db.select().from(mockCarteraCredits).orderBy(mockCarteraCredits.id);
  }

  async applyPayment(input: { creditoId: number; amount: number; reference: string }) {
    const [credit] = await this.db.select().from(mockCarteraCredits).where(eq(mockCarteraCredits.creditoId, input.creditoId)).limit(1);
    if (!credit) {
      throw new Error(`Mock credit ${input.creditoId} not found`);
    }

    const currentBalance = Math.max(0, Number(credit.currentBalance) - input.amount);
    const totalPaid = Number(credit.totalPaid) + input.amount;
    const [updated] = await this.db
      .update(mockCarteraCredits)
      .set({ currentBalance: String(currentBalance), totalPaid: String(totalPaid), updatedAt: new Date() })
      .where(eq(mockCarteraCredits.creditoId, input.creditoId))
      .returning();

    return {
      paymentId: Number(input.reference),
      creditoId: updated.creditoId,
      currentBalance,
      totalPaid,
    };
  }
}
