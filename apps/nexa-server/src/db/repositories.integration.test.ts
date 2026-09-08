import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { ReviewTransferStatus, TokenTransaction } from "../nexa/schemas";
import { startPaymentPolling } from "../jobs/scheduler";
import { runApplicationWorkerOnce } from "../payments/application-worker";
import { runReviewWorkerOnce } from "../payments/review-worker";
import { DbPaymentTransactionRepository, DbReviewRepository, DbTokenUserRepository, PollRunRepository } from "./repositories";
import * as schema from "./schema";
import { nexaPaymentTokens, nexaPaymentTransactions, nexaPollRuns, nexaReviews, nexaTokenUsers } from "./schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const pool = testDatabaseUrl ? new Pool({ connectionString: safeTestDatabaseUrl(testDatabaseUrl), max: 5 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

const transaction: TokenTransaction = {
  reference: "4617307",
  amount: 50,
  bank: "INDLGTGC",
  comments: "sensitive comment",
  currency: "GTQ",
  account: "19451958",
  token: "1234567310005010",
  tokenDate: "2026-05-04T10:00:00-06:00",
  tokenIdentifier: "10005010",
  tokenName: "Sensitive account name",
  tokenPrefix: "1234567",
  wasReturn: 0,
  transactionId: "7293",
};

beforeAll(async () => {
  if (!pool || !db) return;
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
});

afterAll(async () => {
  if (!pool) return;
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.end();
});

beforeEach(async () => {
  if (!db) return;
  await db.delete(nexaPollRuns);
  await db.delete(nexaReviews);
  await db.delete(nexaPaymentTransactions);
  await db.delete(nexaTokenUsers);
  await db.delete(nexaPaymentTokens);
});

integrationTest("two polling coordinators elect one PostgreSQL leader while the Nexa call is running", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let nexaCalls = 0;
  let completedCycles = 0;
  const options = {
    intervalSeconds: 3_600,
    lookbackDays: 1,
    nexa: {
      getPaymentTokenStatement: async () => {
        nexaCalls++;
        await blocked;
        return { transactions: [] };
      },
      reviewTransfer: async () => undefined,
    },
    cartera: { applyNexaPayment: async () => ({ status: "REJECTED" as const, reason: "unused" }) },
    transactions: new DbPaymentTransactionRepository(db),
    tokenUsers: new DbTokenUserRepository(db),
    scheduler: {
      setTimeout: () => { completedCycles++; },
      clearTimeout: () => undefined,
    },
  };

  const stopFirst = startPaymentPolling({ ...options, pollRuns: new PollRunRepository(db) });
  const stopSecond = startPaymentPolling({ ...options, pollRuns: new PollRunRepository(db) });
  await waitFor(() => nexaCalls === 1);
  await waitFor(() => completedCycles === 1);

  const callsWhileLeaderWasBlocked = nexaCalls;
  release?.();
  await waitFor(async () => {
    const runs = await db.select().from(nexaPollRuns);
    return runs.length === 2 && runs.every((run) => run.status === "COMPLETED");
  });
  expect(callsWhileLeaderWasBlocked).toBe(1);
  expect(await db.select().from(nexaPollRuns)).toHaveLength(2);
  stopFirst();
  stopSecond();
});

integrationTest("upsertReceived is concurrent, idempotent, fail-closed and keeps FAILED rows", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);

  const concurrent = await Promise.all([
    repository.upsertReceived(transaction),
    repository.upsertReceived(transaction),
  ]);

  expect(new Set(concurrent.map((row) => row.id)).size).toBe(1);
  expect(concurrent.filter((row) => row.created)).toHaveLength(1);
  expect(await db.select().from(nexaPaymentTransactions)).toHaveLength(1);

  const replay = await repository.upsertReceived(transaction);
  expect(replay).toMatchObject({ id: concurrent[0]?.id, created: false, processingStatus: "RECEIVED" });

  for (const incompatible of [
    { ...transaction, amount: 51 },
    { ...transaction, token: "7654321310005010" },
    { ...transaction, transactionId: "7294" },
  ]) {
    expect(repository.upsertReceived(incompatible)).rejects.toThrow("Incompatible replay for reference 4617307");
  }

  await db.update(nexaPaymentTransactions)
    .set({ processingStatus: "FAILED", failureReason: "retry later" })
    .where(eq(nexaPaymentTransactions.reference, "4617307"));
  const failedReplay = await repository.upsertReceived(transaction);
  expect(failedReplay).toMatchObject({ id: concurrent[0]?.id, created: false, processingStatus: "FAILED" });

  const [stored] = await db.select().from(nexaPaymentTransactions);
  expect(stored).toMatchObject({ account: "", bank: "", comments: "", token: "", tokenName: "" });
  expect(stored?.rawPayload).toEqual({
    reference: "4617307",
    amount: 50,
    currency: "GTQ",
    tokenDate: "2026-05-04T10:00:00-06:00",
    tokenIdentifier: "10005010",
    tokenPrefix: "1234567",
    wasReturn: 0,
    transactionId: "7293",
  });
});

integrationTest("application worker claims once, recovers expired work, backs off and stops retrying", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const stored = await repository.upsertReceived({ ...transaction, reference: "worker-1" });
  const startedAt = new Date("2026-09-08T12:00:00.000Z");

  const claims = await Promise.all([
    repository.claimNextApplication(startedAt, 10),
    repository.claimNextApplication(startedAt, 10),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(claims.find(Boolean)).toMatchObject({ id: stored.id, reference: "worker-1", attemptCount: 1 });

  expect(await repository.claimNextApplication(new Date("2026-09-08T12:00:09.000Z"), 10)).toBeNull();

  let now = new Date("2026-09-08T12:00:11.000Z");
  const fail = () => runApplicationWorkerOnce({
    repository,
    cartera: { applyNexaPayment: async () => { throw new Error("token=1234567310005010 sensitive comment"); } },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 3,
  });

  expect(await fail()).toBe(true);
  let [row] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  expect(row).toMatchObject({ processingStatus: "FAILED", attemptCount: 2, failureReason: "application_processing_failed" });
  expect(row?.nextAttemptAt).toEqual(new Date("2026-09-08T12:00:14.000Z"));
  expect(row?.leaseUntil).toBeNull();

  now = new Date("2026-09-08T12:00:13.999Z");
  expect(await fail()).toBe(false);
  now = new Date("2026-09-08T12:00:14.000Z");
  expect(await fail()).toBe(true);

  [row] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  expect(row).toMatchObject({ processingStatus: "MANUAL_REVIEW", attemptCount: 3, failureReason: "application_processing_failed" });
  expect(row?.nextAttemptAt).toBeNull();
  now = new Date("2027-01-01T00:00:00.000Z");
  expect(await fail()).toBe(false);

});

integrationTest("APPLIED payment persists its id and queues APPROVED without reviewing Nexa inline", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const stored = await repository.upsertReceived(transaction);
  const calls: Array<{ creditoId: number; reference: string | number }> = [];

  expect(await runApplicationWorkerOnce({
    repository,
    cartera: {
      applyNexaPayment: async (input) => {
        calls.push({ creditoId: input.creditoId, reference: input.transaction.reference });
        return { status: "APPLIED", paymentId: 701 };
      },
    },
    now: () => new Date("2026-09-08T13:00:00.000Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  })).toBe(true);

  const [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  const reviews = await db.select().from(nexaReviews);
  expect(payment).toMatchObject({ processingStatus: "REVIEW_PENDING", carteraPaymentId: 701, failureReason: null });
  expect(reviews).toHaveLength(1);
  expect(reviews[0]).toMatchObject({ transactionId: stored.id, reference: "4617307", status: "APPROVED", attempts: 0 });
  expect(calls).toEqual([{ creditoId: 42, reference: "4617307" }]);
  expect(payment?.rawPayload).not.toHaveProperty("token");
});

integrationTest("terminal rejection and missing token association queue safe REJECTED reviews", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const rejected = await repository.upsertReceived({ ...transaction, reference: "4617308", transactionId: "7294" });
  const missing = await repository.upsertReceived({
    ...transaction,
    reference: "4617309",
    transactionId: "7295",
    tokenIdentifier: "10005011",
  });
  let carteraCalls = 0;
  const run = () => runApplicationWorkerOnce({
    repository,
    cartera: {
      applyNexaPayment: async () => {
        carteraCalls++;
        return { status: "REJECTED", reason: "unsafe token=1234567310005010 account=19451958" };
      },
    },
    now: () => new Date("2026-09-08T14:00:00.000Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  });

  expect(await run()).toBe(true);
  expect(await run()).toBe(true);
  const payments = await db.select().from(nexaPaymentTransactions).orderBy(nexaPaymentTransactions.id);
  const reviews = await db.select().from(nexaReviews).orderBy(nexaReviews.id);
  expect(payments).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: rejected.id, processingStatus: "REVIEW_PENDING", failureReason: "cartera_rejected" }),
    expect.objectContaining({ id: missing.id, processingStatus: "REVIEW_PENDING", failureReason: "token_user_not_found" }),
  ]));
  expect(reviews.map((review) => [review.transactionId, review.status])).toEqual([
    [rejected.id, "REJECTED"],
    [missing.id, "REJECTED"],
  ]);
  expect(carteraCalls).toBe(1);
});

integrationTest("uncertain Cartera failure retries the same reference and creates one review", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const stored = await repository.upsertReceived({ ...transaction, reference: "4617310", transactionId: "7296" });
  const references: Array<string | number> = [];
  let now = new Date("2026-09-08T15:00:00.000Z");
  const run = () => runApplicationWorkerOnce({
    repository,
    cartera: {
      applyNexaPayment: async (input) => {
        references.push(input.transaction.reference);
        if (references.length === 1) throw new DOMException("timed out", "TimeoutError");
        return { status: "APPLIED", paymentId: 702, idempotent: true };
      },
    },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  });

  expect(await run()).toBe(true);
  let [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  expect(payment).toMatchObject({ processingStatus: "FAILED", attemptCount: 1 });
  now = new Date("2026-09-08T15:00:02.000Z");
  expect(await run()).toBe(true);
  [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  expect(payment).toMatchObject({ processingStatus: "REVIEW_PENDING", carteraPaymentId: 702, attemptCount: 2 });
  expect(references).toEqual(["4617310", "4617310"]);
  expect(await db.select().from(nexaReviews)).toHaveLength(1);
});

integrationTest("review failure becomes due and then recovers to COMPLETED", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const { paymentId, repository } = await queuedReview("8101", " 9101 ");
  let now = new Date("2026-09-08T16:00:00.000Z");
  let calls = 0;
  const payloads: Array<{ id: number; reference: number; status: ReviewTransferStatus }> = [];
  const run = () => runReviewWorkerOnce({
    repository,
    nexa: {
      reviewTransfer: async (payload) => {
        calls++;
        payloads.push(payload);
        if (calls === 1) throw new Error("upstream detail must not persist");
        return { reference: 8101, status: "APPROVED" };
      },
    },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  });

  expect(await run()).toBe(true);
  let [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, paymentId));
  let [review] = await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, paymentId));
  expect(payment?.processingStatus).toBe("REVIEW_PENDING");
  expect(review).toMatchObject({ attempts: 1, lastError: "review_processing_failed", completedAt: null });
  expect(review?.nextAttemptAt).toEqual(new Date("2026-09-08T16:00:02.000Z"));
  now = new Date("2026-09-08T16:00:01.999Z");
  expect(await run()).toBe(false);
  now = new Date("2026-09-08T16:00:02.000Z");
  expect(await run()).toBe(true);
  [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, paymentId));
  [review] = await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, paymentId));
  expect(payment?.processingStatus).toBe("COMPLETED");
  expect(review).toMatchObject({ attempts: 2, lastError: null });
  expect(review?.completedAt).toEqual(now);
  expect(review?.responsePayload).toEqual({ reference: 8101, status: "APPROVED" });
  expect(payloads).toEqual([
    { id: 9101, reference: 8101, status: "APPROVED" },
    { id: 9101, reference: 8101, status: "APPROVED" },
  ]);
});

integrationTest("two review workers cannot claim the same review", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const { repository } = await queuedReview("8102", "9102");
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const options = {
    repository,
    nexa: {
      reviewTransfer: async () => {
        calls++;
        await blocked;
        return { reference: 8102, status: "APPROVED" as const };
      },
    },
    now: () => new Date("2026-09-08T17:00:00.000Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  };

  const first = runReviewWorkerOnce(options);
  await waitFor(() => calls === 1);
  expect(await runReviewWorkerOnce(options)).toBe(false);
  release?.();
  expect(await first).toBe(true);
  expect(calls).toBe(1);
});

integrationTest("review max attempts moves payment to MANUAL_REVIEW", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const { paymentId, repository } = await queuedReview("8103", "9103");
  let now = new Date("2026-09-08T18:00:00.000Z");
  const run = () => runReviewWorkerOnce({
    repository,
    nexa: { reviewTransfer: async () => { throw new Error("Nexa unavailable"); } },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 2,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  });

  expect(await run()).toBe(true);
  now = new Date("2026-09-08T18:00:02.000Z");
  expect(await run()).toBe(true);
  const [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, paymentId));
  const [review] = await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, paymentId));
  expect(payment?.processingStatus).toBe("MANUAL_REVIEW");
  expect(review).toMatchObject({ attempts: 2, lastError: "review_processing_failed", nextAttemptAt: null });
  expect(review?.completedAt).toEqual(now);
});

integrationTest("review without a reviewable transactionId completes without calling Nexa", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const { paymentId, repository } = await queuedReview("8104", "");
  let called = false;
  expect(await runReviewWorkerOnce({
    repository,
    nexa: { reviewTransfer: async () => { called = true; } },
    now: () => new Date("2026-09-08T19:00:00.000Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  })).toBe(true);
  const [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, paymentId));
  expect(payment?.processingStatus).toBe("COMPLETED");
  expect(called).toBe(false);
});

async function associateToken(identifier: string, prefix: string, creditoId: number) {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const [paymentToken] = await db.insert(nexaPaymentTokens).values({
    nexaTokenId: creditoId,
    prefix,
    account: "stored only in token configuration",
    name: "stored only in token configuration",
  }).returning();
  if (!paymentToken) throw new Error("payment token was not created");
  await db.insert(nexaTokenUsers).values({
    paymentTokenId: paymentToken.id,
    nexaUserId: creditoId,
    creditoId,
    identifier,
    token: `${prefix}${identifier}`,
    description: "test",
    nationalId: String(creditoId),
  });
}

async function queuedReview(reference: string, transactionId: string) {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const transactions = new DbPaymentTransactionRepository(db);
  const stored = await transactions.upsertReceived({ ...transaction, reference, transactionId });
  await transactions.finalizeApplication(stored.id, {
    paymentId: 900,
    reviewStatus: "APPROVED",
    failureReason: null,
  }, new Date("2026-09-08T12:00:00.000Z"));
  return { paymentId: stored.id, repository: new DbReviewRepository(db) };
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let index = 0; index < 100 && !(await predicate()); index++) {
    await Bun.sleep(1);
  }
  if (!(await predicate())) throw new Error("condition was not reached");
}

function safeTestDatabaseUrl(value: string) {
  const url = new URL(value);
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) || url.pathname !== "/nexa_inbox_test") {
    throw new Error("TEST_DATABASE_URL must target local database nexa_inbox_test");
  }
  return value;
}
