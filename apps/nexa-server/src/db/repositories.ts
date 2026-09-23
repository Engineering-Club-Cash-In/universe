import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { receivedTokenTransactionSchema, tokenTransactionSchema, type TokenTransaction, type ReceivedTokenTransaction } from "../nexa/schemas";
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
  private missingDateCursor = 0;

  constructor(private readonly db: NexaDb) {}

  async upsertReceived(input: ReceivedTokenTransaction) {
    const transaction = receivedTokenTransactionSchema.parse(input);
    const reference = String(transaction.reference);
    const tokenDate = transaction.tokenDate ?? "";
    const payloadFingerprint = fingerprint({ ...transaction, reference, tokenDate });
    const sanitizedPayload = {
      reference,
      amount: transaction.amount,
      currency: transaction.currency,
      ...(tokenDate ? { tokenDate } : {}),
      tokenIdentifier: transaction.tokenIdentifier,
      tokenPrefix: transaction.tokenPrefix,
      wasReturn: transaction.wasReturn,
      transactionId: transaction.transactionId,
    };
    const canEnrich = sql`
      ${nexaPaymentTransactions.tokenDate} = ''
      AND excluded.token_date <> ''
      AND ${nexaPaymentTransactions.amount} = excluded.amount
      AND ${nexaPaymentTransactions.currency} = excluded.currency
      AND ${nexaPaymentTransactions.tokenIdentifier} = excluded.token_identifier
      AND ${nexaPaymentTransactions.tokenPrefix} = excluded.token_prefix
      AND ${nexaPaymentTransactions.wasReturn} = excluded.was_return
      AND ${nexaPaymentTransactions.transactionId} = excluded.transaction_id
    `;
    const [stored] = await this.db.insert(nexaPaymentTransactions).values({
      reference,
      amount: String(transaction.amount),
      bank: "",
      comments: "",
      currency: transaction.currency,
      account: "",
      token: "",
      tokenDate,
      tokenIdentifier: transaction.tokenIdentifier,
      tokenName: "",
      tokenPrefix: transaction.tokenPrefix,
      wasReturn: transaction.wasReturn,
      transactionId: transaction.transactionId,
      processingStatus: tokenDate ? "RECEIVED" : "MANUAL_REVIEW",
      failureReason: tokenDate ? null : "missing_token_date",
      rawPayload: sanitizedPayload,
      payloadFingerprint,
    }).onConflictDoUpdate({
      target: nexaPaymentTransactions.reference,
      set: {
        tokenDate: sql`CASE WHEN ${canEnrich} THEN excluded.token_date ELSE ${nexaPaymentTransactions.tokenDate} END`,
        processingStatus: sql`CASE WHEN ${canEnrich} AND ${nexaPaymentTransactions.failureReason} = 'missing_token_date' THEN 'RECEIVED'::nexa_processing_status ELSE ${nexaPaymentTransactions.processingStatus} END`,
        failureReason: sql`CASE WHEN ${canEnrich} AND ${nexaPaymentTransactions.failureReason} = 'missing_token_date' THEN NULL ELSE ${nexaPaymentTransactions.failureReason} END`,
        rawPayload: sql`CASE WHEN ${canEnrich} THEN excluded.raw_payload ELSE ${nexaPaymentTransactions.rawPayload} END`,
        payloadFingerprint: sql`CASE WHEN ${canEnrich} THEN excluded.payload_fingerprint ELSE ${nexaPaymentTransactions.payloadFingerprint} END`,
        updatedAt: sql`CASE WHEN ${canEnrich} THEN NOW() ELSE ${nexaPaymentTransactions.updatedAt} END`,
      },
    }).returning({
      id: nexaPaymentTransactions.id,
      reference: nexaPaymentTransactions.reference,
      amount: nexaPaymentTransactions.amount,
      token: nexaPaymentTransactions.token,
      transactionId: nexaPaymentTransactions.transactionId,
      currency: nexaPaymentTransactions.currency,
      tokenDate: nexaPaymentTransactions.tokenDate,
      tokenIdentifier: nexaPaymentTransactions.tokenIdentifier,
      tokenPrefix: nexaPaymentTransactions.tokenPrefix,
      wasReturn: nexaPaymentTransactions.wasReturn,
      processingStatus: nexaPaymentTransactions.processingStatus,
      payloadFingerprint: nexaPaymentTransactions.payloadFingerprint,
      created: sql<boolean>`xmax = 0`,
    });

    const storedBaseFingerprint = fingerprint({
      reference: stored.reference,
      amount: stored.amount,
      currency: paymentCurrency(stored.currency),
      tokenDate: "",
      tokenIdentifier: stored.tokenIdentifier,
      tokenPrefix: stored.tokenPrefix,
      wasReturn: paymentReturn(stored.wasReturn),
      transactionId: stored.transactionId,
    });
    const incomingBaseFingerprint = fingerprint({ ...transaction, reference, tokenDate: "" });
    if (
      storedBaseFingerprint !== incomingBaseFingerprint ||
      (tokenDate && stored.tokenDate && stored.tokenDate !== tokenDate)
    ) {
      throw new Error(`Incompatible replay for reference ${reference}`);
    }

    return {
      id: stored.id,
      reference: stored.reference,
      processingStatus: stored.processingStatus,
      created: stored.created,
    };
  }

  async listMissingDateReceipts() {
    // Rotate bounded batches; unmatched older receipts must not block newer ones.
    const loadBatch = () => this.db.select({ id: nexaPaymentTransactions.id, reference: nexaPaymentTransactions.reference, createdAt: nexaPaymentTransactions.createdAt })
      .from(nexaPaymentTransactions).where(and(
        eq(nexaPaymentTransactions.processingStatus, "MANUAL_REVIEW"),
        eq(nexaPaymentTransactions.failureReason, "missing_token_date"),
        eq(nexaPaymentTransactions.tokenDate, ""),
        sql`${nexaPaymentTransactions.createdAt} >= NOW() - INTERVAL '48 hours'`,
        sql`${nexaPaymentTransactions.id} > ${this.missingDateCursor}`,
      )).orderBy(nexaPaymentTransactions.id).limit(100);
    let rows = await loadBatch();
    if (rows.length === 0 && this.missingDateCursor !== 0) {
      this.missingDateCursor = 0;
      rows = await loadBatch();
    }
    this.missingDateCursor = rows.length === 100 ? rows.at(-1)?.id ?? 0 : 0;
    return rows.map(({ reference, createdAt }) => ({ reference, createdAt }));
  }

  // Incoming statement transactionId is blank; the webhook ID belongs to review.
  // Enrich existing receipts only. Never ingest unrelated statement funds here.
  async enrichIncomingStatement(input: TokenTransaction) {
    const incoming = tokenTransactionSchema.parse(input);
    if (incoming.transactionId.trim() !== "" || incoming.amount <= 0 || incoming.wasReturn !== 0 ||
        incoming.token !== incoming.tokenPrefix + incoming.tokenIdentifier) return false;
    const reference = String(incoming.reference);
    return this.db.transaction(async (tx) => {
      const [stored] = await tx.select().from(nexaPaymentTransactions)
        .where(eq(nexaPaymentTransactions.reference, reference)).for("update");
      if (!stored || stored.tokenDate !== "" || stored.processingStatus !== "MANUAL_REVIEW" ||
          stored.failureReason !== "missing_token_date" || !/^\d+$/.test(stored.transactionId)) return false;
      const matches = stored.amount === incoming.amount.toFixed(2) && stored.currency === incoming.currency &&
        stored.tokenIdentifier === incoming.tokenIdentifier && stored.tokenPrefix === incoming.tokenPrefix &&
        stored.wasReturn === incoming.wasReturn;
      if (!matches) return false;
      const payload = {
        reference, amount: incoming.amount, currency: incoming.currency, tokenDate: incoming.tokenDate,
        tokenIdentifier: incoming.tokenIdentifier, tokenPrefix: incoming.tokenPrefix,
        wasReturn: incoming.wasReturn, transactionId: stored.transactionId,
        bankTransactionId: incoming.transactionId.trim(),
      };
      await tx.update(nexaPaymentTransactions).set({
        tokenDate: incoming.tokenDate, processingStatus: "RECEIVED", failureReason: null,
        rawPayload: payload, payloadFingerprint: fingerprint(payload), updatedAt: new Date(),
      }).where(eq(nexaPaymentTransactions.id, stored.id));
      return true;
    });
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
        WHERE token_date <> ''
          AND (
            processing_status = 'RECEIVED'
            OR (processing_status = 'FAILED' AND next_attempt_at <= ${now})
            OR (processing_status = 'APPLYING' AND lease_until <= ${now})
          )
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
        payment.token_date AS "tokenDate",
        payment.token_identifier AS "tokenIdentifier",
        payment.token_prefix AS "tokenPrefix",
        COALESCE(payment.raw_payload->>'bankTransactionId', payment.transaction_id) AS "transactionId",
        payment.was_return AS "wasReturn",
        payment.attempt_count AS "attemptCount"
    `);
    const row = result.rows[0];
    return row ? {
      id: Number(row.id),
      reference: String(row.reference),
      amount: Number(row.amount),
      currency: paymentCurrency(row.currency),
      tokenDate: String(row.tokenDate),
      tokenIdentifier: String(row.tokenIdentifier),
      tokenPrefix: String(row.tokenPrefix),
      transactionId: String(row.transactionId),
      wasReturn: paymentReturn(row.wasReturn),
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
  }, now: Date, attemptCount: number) {
    await this.db.transaction(async (tx) => {
      const [payment] = await tx.update(nexaPaymentTransactions).set({
        processingStatus: "REVIEW_PENDING",
        carteraPaymentId: outcome.paymentId,
        failureReason: outcome.failureReason,
        nextAttemptAt: null,
        leaseUntil: null,
        updatedAt: now,
      }).where(and(
        eq(nexaPaymentTransactions.id, id),
        eq(nexaPaymentTransactions.attemptCount, attemptCount),
        eq(nexaPaymentTransactions.processingStatus, "APPLYING"),
      )).returning({
        reference: nexaPaymentTransactions.reference,
      });
      if (!payment) return;
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

  async markApplicationFailed(id: number, reason: string, nextAttemptAt: Date | null, now: Date, attemptCount: number) {
    await this.db.update(nexaPaymentTransactions).set({
      processingStatus: nextAttemptAt ? "FAILED" : "MANUAL_REVIEW",
      failureReason: reason,
      nextAttemptAt,
      leaseUntil: null,
      updatedAt: now,
    }).where(and(
      eq(nexaPaymentTransactions.id, id),
      eq(nexaPaymentTransactions.attemptCount, attemptCount),
      eq(nexaPaymentTransactions.processingStatus, "APPLYING"),
    ));
  }

  async listReconciliation() {
    return (await reconciliationQuery(this.db)).map(toSafeReconciliationRow);
  }

  async listReconciliationAlerts(now: Date, staleBefore: Date) {
    const rows = await reconciliationQuery(this.db, or(
      and(
        eq(nexaPaymentTransactions.processingStatus, "FAILED"),
        or(
          lte(nexaPaymentTransactions.nextAttemptAt, now),
          and(isNull(nexaPaymentTransactions.nextAttemptAt), lte(nexaPaymentTransactions.updatedAt, staleBefore)),
        ),
      ),
      and(eq(nexaPaymentTransactions.processingStatus, "REVIEW_PENDING"), lte(nexaPaymentTransactions.updatedAt, staleBefore)),
    ));
    return rows.map((row) => ({
      ...toSafeReconciliationRow(row),
      alertType: row.processingStatus === "REVIEW_PENDING"
        ? "REVIEW_PENDING_AGED" as const
        : row.nextAttemptAt && row.nextAttemptAt <= now
          ? "FAILED_DUE" as const
          : "FAILED_AGED" as const,
    }));
  }

  async listManualReviewAlerts(staleBefore: Date) {
    const rows = await reconciliationQuery(this.db, or(
      and(eq(nexaPaymentTransactions.tokenDate, ""), lte(nexaPaymentTransactions.updatedAt, staleBefore)),
      and(
        eq(nexaPaymentTransactions.processingStatus, "MANUAL_REVIEW"),
        or(isNull(nexaPaymentTransactions.failureReason), ne(nexaPaymentTransactions.failureReason, "missing_token_date")),
      ),
    ));
    return rows.map((row) => ({
      ...toSafeReconciliationRow(row),
      alertType: row.failureReason === "missing_token_date"
        ? "MISSING_TOKEN_DATE" as const
        : "MANUAL_REVIEW" as const,
    }));
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
      const [review] = await tx.update(nexaReviews).set({
        responsePayload,
        lastError: null,
        nextAttemptAt: null,
        leaseUntil: null,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(nexaReviews.id, claim.id),
        eq(nexaReviews.attempts, claim.attemptCount),
        isNull(nexaReviews.completedAt),
        isNotNull(nexaReviews.leaseUntil),
      )).returning({ id: nexaReviews.id });
      if (!review) return;
      const [payment] = await tx.update(nexaPaymentTransactions).set({
        processingStatus: "COMPLETED",
        updatedAt: now,
      }).where(and(
        eq(nexaPaymentTransactions.id, claim.paymentTransactionId),
        eq(nexaPaymentTransactions.processingStatus, "REVIEW_PENDING"),
      )).returning({ id: nexaPaymentTransactions.id });
      if (!payment) throw new Error("Review payment is not active");
    });
  }

  async failReview(claim: ReviewClaim, nextAttemptAt: Date | null, now: Date) {
    await this.db.transaction(async (tx) => {
      const [review] = await tx.update(nexaReviews).set({
        lastError: "review_processing_failed",
        nextAttemptAt,
        leaseUntil: null,
        completedAt: nextAttemptAt ? null : now,
        updatedAt: now,
      }).where(and(
        eq(nexaReviews.id, claim.id),
        eq(nexaReviews.attempts, claim.attemptCount),
        isNull(nexaReviews.completedAt),
        isNotNull(nexaReviews.leaseUntil),
      )).returning({ id: nexaReviews.id });
      if (!review) return;
      const [payment] = await tx.update(nexaPaymentTransactions).set({
        processingStatus: nextAttemptAt ? "REVIEW_PENDING" : "MANUAL_REVIEW",
        updatedAt: now,
      }).where(and(
        eq(nexaPaymentTransactions.id, claim.paymentTransactionId),
        eq(nexaPaymentTransactions.processingStatus, "REVIEW_PENDING"),
      )).returning({ id: nexaPaymentTransactions.id });
      if (!payment) throw new Error("Review payment is not active");
    });
  }
}

type PaymentFingerprintInput = {
  reference: string;
  amount: string | number;
  currency: "GTQ" | "USD";
  tokenDate: string;
  tokenIdentifier: string;
  tokenPrefix: string;
  wasReturn: 0 | 1;
  transactionId: string;
};

function fingerprint(input: PaymentFingerprintInput) {
  const canonical = [
    input.reference,
    Number(input.amount).toFixed(2),
    input.currency,
    input.tokenDate,
    input.tokenIdentifier,
    input.tokenPrefix,
    input.wasReturn,
    input.transactionId,
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function paymentCurrency(value: unknown): "GTQ" | "USD" {
  if (value !== "GTQ" && value !== "USD") throw new Error("Stored payment currency is invalid");
  return value;
}

function paymentReturn(value: unknown): 0 | 1 {
  const number = Number(value);
  if (number !== 0 && number !== 1) throw new Error("Stored payment return flag is invalid");
  return number;
}

function storedReviewStatus(value: unknown): "APPROVED" | "REJECTED" {
  if (value !== "APPROVED" && value !== "REJECTED") throw new Error("Stored review status is invalid");
  return value;
}

function reconciliationQuery(db: NexaDb, where?: ReturnType<typeof or>) {
  const token = sql<string>`COALESCE(NULLIF(${nexaPaymentTransactions.token}, ''), CASE WHEN ${nexaPaymentTokens.id} IS NOT NULL THEN ${nexaTokenUsers.token} END, ${nexaPaymentTransactions.tokenPrefix} || ${nexaPaymentTransactions.tokenIdentifier})`;
  const query = db.select({
    reference: nexaPaymentTransactions.reference,
    token: sql<string>`CASE WHEN length(${token}) <= 4 THEN repeat('*', length(${token})) ELSE repeat('*', length(${token}) - 4) || right(${token}, 4) END`,
    creditoId: sql<number | null>`CASE WHEN ${nexaPaymentTokens.id} IS NOT NULL THEN ${nexaTokenUsers.creditoId} END`,
    carteraPaymentId: nexaPaymentTransactions.carteraPaymentId,
    amount: nexaPaymentTransactions.amount,
    processingStatus: nexaPaymentTransactions.processingStatus,
    attemptCount: nexaPaymentTransactions.attemptCount,
    reviewAttempts: nexaReviews.attempts,
    storedReviewAttemptCount: nexaPaymentTransactions.reviewAttemptCount,
    failureReason: nexaPaymentTransactions.failureReason,
    createdAt: nexaPaymentTransactions.createdAt,
    updatedAt: nexaPaymentTransactions.updatedAt,
    nextAttemptAt: nexaPaymentTransactions.nextAttemptAt,
    reviewNextAttemptAt: nexaReviews.nextAttemptAt,
    storedReviewNextAttemptAt: nexaPaymentTransactions.reviewNextAttemptAt,
  }).from(nexaPaymentTransactions)
    .leftJoin(nexaTokenUsers, eq(nexaTokenUsers.identifier, nexaPaymentTransactions.tokenIdentifier))
    .leftJoin(nexaPaymentTokens, and(
      eq(nexaPaymentTokens.id, nexaTokenUsers.paymentTokenId),
      eq(nexaPaymentTokens.prefix, nexaPaymentTransactions.tokenPrefix),
    ))
    .leftJoin(nexaReviews, eq(nexaReviews.transactionId, nexaPaymentTransactions.id));
  return (where ? query.where(where) : query).orderBy(nexaPaymentTransactions.id);
}

function toSafeReconciliationRow<T extends {
  failureReason: string | null;
  reviewAttempts: number | null;
  storedReviewAttemptCount: number;
  reviewNextAttemptAt: Date | null;
  storedReviewNextAttemptAt: Date | null;
}>(row: T) {
  const { reviewAttempts, storedReviewAttemptCount, reviewNextAttemptAt, storedReviewNextAttemptAt, ...safeRow } = row;
  return {
    ...safeRow,
    reviewAttemptCount: reviewAttempts ?? storedReviewAttemptCount,
    reviewNextAttemptAt: reviewNextAttemptAt ?? storedReviewNextAttemptAt,
    failureReason: row.failureReason && /^[a-z0-9_]{1,64}$/.test(row.failureReason)
      ? row.failureReason
      : row.failureReason
        ? "processing_failed"
        : null,
  };
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
      await this.db.update(nexaPollRuns).set({ status: "FAILED", error: "polling_failed", finishedAt: new Date() }).where(eq(nexaPollRuns.id, run.id));
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
