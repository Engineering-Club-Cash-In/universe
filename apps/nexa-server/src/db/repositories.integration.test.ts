import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { createApp } from "../app";
import type { ReviewTransferStatus, TokenTransaction } from "../nexa/schemas";
import { runApplicationWorkerOnce } from "../payments/application-worker";
import { HttpCarteraPaymentClient } from "../payments/cartera-client";
import { runReviewWorkerOnce } from "../payments/review-worker";
import { createAdminRouter } from "../routes/admin";
import { DbPaymentTransactionRepository, DbReviewRepository, DbTokenUserRepository, PaymentTokenRepository, PollRunRepository } from "./repositories";
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

integrationTest("rejects sub-cent amounts before persistence without colliding replays", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);

  await repository.upsertReceived({ ...transaction, reference: "cent-safe", amount: 0.29 });
  for (const amount of [10.001, 10.002]) {
    expect(repository.upsertReceived({ ...transaction, reference: "sub-cent", amount })).rejects.toThrow();
  }

  const rows = await db.select({ reference: nexaPaymentTransactions.reference, amount: nexaPaymentTransactions.amount })
    .from(nexaPaymentTransactions);
  expect(rows).toEqual([{ reference: "cent-safe", amount: "0.29" }]);
});

integrationTest("readiness rejects the legacy schema and accepts the durable schema", async () => {
  if (!db || !pool) throw new Error("TEST_DATABASE_URL is required");
  const config = {
    enableTestUi: false,
    enableAdminApi: false,
    nexaWebhookFlowId: "test-flow",
    nexaWebhookBearerToken: "test-token",
  } as never;

  const current = await createApp(config, { db } as never).request("/ready");
  expect(current.status).toBe(200);

  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(`
      ALTER TABLE nexa_payment_transactions
        DROP COLUMN payload_fingerprint,
        DROP COLUMN attempt_count,
        DROP COLUMN next_attempt_at,
        DROP COLUMN last_attempt_at,
        DROP COLUMN lease_until,
        DROP COLUMN review_attempt_count,
        DROP COLUMN review_next_attempt_at;
      ALTER TABLE nexa_reviews
        DROP COLUMN next_attempt_at,
        DROP COLUMN lease_until,
        DROP COLUMN completed_at;
    `);
    const legacyDb = drizzle(connection, { schema });
    const legacy = await createApp(config, { db: legacyDb } as never).request("/ready");
    expect(legacy.status).toBe(503);
    expect(await legacy.json()).toEqual({ ok: false, reason: "schema_not_migrated" });
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
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
  const [sanitized] = await db.select().from(nexaPaymentTransactions)
    .where(eq(nexaPaymentTransactions.reference, "4617307"));
  expect(sanitized).toMatchObject({ account: "", bank: "", comments: "", token: "", tokenName: "" });
  expect(sanitized?.rawPayload).toEqual({
    reference: "4617307",
    amount: 50,
    currency: "GTQ",
    tokenDate: "2026-05-04T10:00:00-06:00",
    tokenIdentifier: "10005010",
    tokenPrefix: "1234567",
    wasReturn: 0,
    transactionId: "7293",
  });

  for (const incompatible of [
    { ...transaction, amount: 51 },
    { ...transaction, tokenIdentifier: "10005011" },
    { ...transaction, transactionId: "7294" },
    { ...transaction, currency: "USD" as const },
    { ...transaction, wasReturn: 1 as const },
  ]) {
    expect(repository.upsertReceived(incompatible)).rejects.toThrow("Incompatible replay for reference 4617307");
  }

  for (const [original, replay] of [
    [
      { ...transaction, reference: "currency-reverse", currency: "USD" as const },
      { ...transaction, reference: "currency-reverse", currency: "GTQ" as const },
    ],
    [
      { ...transaction, reference: "return-reverse", wasReturn: 1 as const },
      { ...transaction, reference: "return-reverse", wasReturn: 0 as const },
    ],
  ]) {
    await repository.upsertReceived(original);
    expect(repository.upsertReceived(replay)).rejects.toThrow(`Incompatible replay for reference ${original.reference}`);
  }

  await db.update(nexaPaymentTransactions)
    .set({ payloadFingerprint: null, token: transaction.token })
    .where(eq(nexaPaymentTransactions.reference, "4617307"));
  expect(await repository.upsertReceived(transaction)).toMatchObject({
    id: concurrent[0]?.id,
    created: false,
  });
  for (const incompatible of [
    { ...transaction, currency: "USD" as const },
    { ...transaction, wasReturn: 1 as const },
  ]) {
    expect(repository.upsertReceived(incompatible)).rejects.toThrow("Incompatible replay for reference 4617307");
  }

  await db.update(nexaPaymentTransactions)
    .set({ processingStatus: "FAILED", failureReason: "retry later" })
    .where(eq(nexaPaymentTransactions.reference, "4617307"));
  const failedReplay = await repository.upsertReceived(transaction);
  expect(failedReplay).toMatchObject({ id: concurrent[0]?.id, created: false, processingStatus: "FAILED" });

});

integrationTest("0004 classifies legacy PENDING payments for manual reconciliation", async () => {
  if (!db || !pool) throw new Error("TEST_DATABASE_URL is required");
  const migration = Bun.file(new URL("../../drizzle/0004_classify_legacy_pending.sql", import.meta.url));
  const exists = await migration.exists();
  expect(exists).toBe(true);
  if (!exists) return;

  const repository = new DbPaymentTransactionRepository(db);
  const stored = await repository.upsertReceived({ ...transaction, reference: "legacy-pending" });
  await db.update(nexaPaymentTransactions)
    .set({ processingStatus: "PENDING", failureReason: null })
    .where(eq(nexaPaymentTransactions.id, stored.id));

  await pool.query(await migration.text());

  const [row] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  expect(row).toMatchObject({
    processingStatus: "MANUAL_REVIEW",
    failureReason: "legacy_pending_requires_reconciliation",
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

integrationTest("stale application claimants cannot overwrite replacement success or failure", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  const claimedAt = new Date("2026-09-08T12:00:00.000Z");
  const reclaimedAt = new Date("2026-09-08T12:00:11.000Z");

  const success = await repository.upsertReceived({ ...transaction, reference: "application-fence-success" });
  const oldSuccess = await repository.claimNextApplication(claimedAt, 10);
  const replacementSuccess = await repository.claimNextApplication(reclaimedAt, 10);
  if (!oldSuccess || !replacementSuccess) throw new Error("application claims were not created");
  await repository.finalizeApplication(replacementSuccess.id, {
    paymentId: 801,
    reviewStatus: "APPROVED",
    failureReason: null,
  }, reclaimedAt, replacementSuccess.attemptCount);
  await repository.markApplicationFailed(
    oldSuccess.id,
    "application_processing_failed",
    null,
    new Date("2026-09-08T12:00:12.000Z"),
    oldSuccess.attemptCount,
  );
  const [successfulRow] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, success.id));
  expect(successfulRow).toMatchObject({ processingStatus: "REVIEW_PENDING", carteraPaymentId: 801 });
  expect(await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, success.id))).toHaveLength(1);

  const failed = await repository.upsertReceived({ ...transaction, reference: "application-fence-failure" });
  const oldFailure = await repository.claimNextApplication(claimedAt, 10);
  const replacementFailure = await repository.claimNextApplication(reclaimedAt, 10);
  if (!oldFailure || !replacementFailure) throw new Error("application claims were not created");
  await repository.markApplicationFailed(
    replacementFailure.id,
    "application_processing_failed",
    null,
    reclaimedAt,
    replacementFailure.attemptCount,
  );
  await repository.finalizeApplication(oldFailure.id, {
    paymentId: 802,
    reviewStatus: "APPROVED",
    failureReason: null,
  }, new Date("2026-09-08T12:00:12.000Z"), oldFailure.attemptCount);
  const [failedRow] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, failed.id));
  expect(failedRow).toMatchObject({ processingStatus: "MANUAL_REVIEW", carteraPaymentId: null });
  expect(await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, failed.id))).toHaveLength(0);
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

integrationTest("returned transfers queue a safe REJECTED review without calling Cartera", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const stored = await repository.upsertReceived({
    ...transaction,
    reference: "returned-transfer",
    transactionId: "returned-transaction",
    wasReturn: 1,
  });
  let carteraCalls = 0;

  expect(await runApplicationWorkerOnce({
    repository,
    cartera: {
      applyNexaPayment: async () => {
        carteraCalls += 1;
        return { status: "APPLIED", paymentId: 999 };
      },
    },
    now: () => new Date("2026-09-08T13:30:00.000Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  })).toBe(true);

  const [payment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, stored.id));
  const [review] = await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, stored.id));
  expect(carteraCalls).toBe(0);
  expect(payment).toMatchObject({ processingStatus: "REVIEW_PENDING", carteraPaymentId: null, failureReason: "returned_transfer" });
  expect(review).toMatchObject({ status: "REJECTED" });
});

integrationTest("terminal rejection and missing token association queue safe REJECTED reviews", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const unsafe = await repository.upsertReceived({ ...transaction, reference: "4617318", transactionId: "7298" });
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
    expect.objectContaining({ id: unsafe.id, processingStatus: "REVIEW_PENDING", failureReason: "cartera_rejected" }),
    expect.objectContaining({ id: missing.id, processingStatus: "REVIEW_PENDING", failureReason: "token_user_not_found" }),
  ]));
  expect(reviews.map((review) => [review.transactionId, review.status])).toEqual([
    [unsafe.id, "REJECTED"],
    [missing.id, "REJECTED"],
  ]);
  expect(carteraCalls).toBe(1);
});

integrationTest("payment_amount_mismatch agota intentos en MANUAL_REVIEW sin revisión bancaria", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const stored = await repository.upsertReceived({
    ...transaction,
    reference: "amount-mismatch",
    transactionId: "7294",
  });
  let carteraCalls = 0;
  let now = new Date("2026-09-08T14:30:00.000Z");
  const cartera = new HttpCarteraPaymentClient({
    baseUrl: "https://cartera.example.test",
    secret: "c".repeat(32),
    fetch: async () => {
      carteraCalls += 1;
      return Response.json({ error: "payment_amount_mismatch" }, { status: 409 });
    },
  });
  const run = () => runApplicationWorkerOnce({
    repository,
    cartera,
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  });

  expect(await run()).toBe(true);
  now = new Date("2026-09-08T14:30:02.000Z");
  expect(await run()).toBe(true);
  now = new Date("2026-09-08T14:30:06.000Z");
  expect(await run()).toBe(true);

  const [payment] = await db.select().from(nexaPaymentTransactions)
    .where(eq(nexaPaymentTransactions.id, stored.id));
  expect(payment).toMatchObject({
    processingStatus: "MANUAL_REVIEW",
    attemptCount: 3,
    failureReason: "application_processing_failed",
  });
  expect(carteraCalls).toBe(3);
  expect(await db.select().from(nexaReviews)).toHaveLength(0);

  let bankReviews = 0;
  expect(await runReviewWorkerOnce({
    repository: new DbReviewRepository(db),
    nexa: { reviewTransfer: async () => { bankReviews += 1; } },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  })).toBe(false);
  expect(bankReviews).toBe(0);
});

integrationTest("authenticated reconciliation routes join PostgreSQL rows and never expose payment PII", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const token = "1234567310005010";
  const [paymentToken] = await db.insert(nexaPaymentTokens).values({
    nexaTokenId: 455,
    prefix: token.slice(0, 7),
    account: "token-account-secret",
    name: "token-name-secret",
  }).returning();
  if (!paymentToken) throw new Error("payment token was not created");
  await db.insert(nexaTokenUsers).values({
    paymentTokenId: paymentToken.id,
    nexaUserId: 42,
    creditoId: 42,
    identifier: token.slice(-9),
    token,
    description: "private description",
    nationalId: "1234567890101",
  });
  await db.insert(nexaPaymentTokens).values({
    nexaTokenId: 456,
    prefix: token.slice(0, 7),
    account: "historical-account-secret",
    name: "historical-token-secret",
    active: false,
  });
  const createdAt = new Date("2026-09-08T10:00:00.000Z");
  const updatedAt = new Date("2026-09-08T11:00:00.000Z");
  const reviewNextAttemptAt = new Date("2026-09-08T12:00:00.000Z");
  const reference = "ref,\"line\n2";
  const [payment] = await db.insert(nexaPaymentTransactions).values({
    reference,
    amount: "50.00",
    bank: "private-bank",
    comments: "private-comments",
    currency: "GTQ",
    account: "private-account",
    token,
    tokenDate: createdAt.toISOString(),
    tokenIdentifier: token.slice(-9),
    tokenName: "private-token-name",
    tokenPrefix: token.slice(0, 7),
    wasReturn: 0,
    transactionId: "7293",
    processingStatus: "REVIEW_PENDING",
    carteraPaymentId: 701,
    failureReason: "payment_amount_mismatch",
    rawPayload: { secret: "raw-payload-secret" },
    attemptCount: 2,
    reviewAttemptCount: 99,
    createdAt,
    updatedAt,
  }).returning();
  if (!payment) throw new Error("payment was not created");
  await db.insert(nexaReviews).values({
    transactionId: payment.id,
    reference,
    status: "REJECTED",
    requestPayload: { secret: "review-request-secret" },
    responsePayload: { secret: "review-response-secret" },
    attempts: 3,
    nextAttemptAt: reviewNextAttemptAt,
  });

  const transactions = new DbPaymentTransactionRepository(db);
  const router = createAdminRouter({
    adminApiKey: "admin-secret",
    nexa: {} as never,
    cartera: {} as never,
    paymentTokens: new PaymentTokenRepository(db),
    tokenUsers: new DbTokenUserRepository(db),
    transactions,
    pollRuns: new PollRunRepository(db),
    accumulatorAccount: 1,
    paymentTokenName: "test",
  });
  const headers = { Authorization: "Bearer admin-secret" };

  const unauthorized = await router.request("/reconciliation");
  const jsonResponse = await router.request("/reconciliation", { headers });
  const transactionsResponse = await router.request("/transactions", { headers });
  const csvResponse = await router.request("/reconciliation?format=csv", { headers });
  const jsonBody = await jsonResponse.text();
  const transactionsBody = await transactionsResponse.text();
  const csvBody = await csvResponse.text();

  expect(unauthorized.status).toBe(401);
  expect(jsonResponse.status).toBe(200);
  expect(JSON.parse(jsonBody)).toEqual({ transactions: [{
    reference,
    token: "************5010",
    creditoId: 42,
    carteraPaymentId: 701,
    amount: "50.00",
    processingStatus: "REVIEW_PENDING",
    attemptCount: 2,
    reviewAttemptCount: 3,
    failureReason: "payment_amount_mismatch",
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    nextAttemptAt: null,
    reviewNextAttemptAt: reviewNextAttemptAt.toISOString(),
  }] });
  expect(transactionsBody).toBe(jsonBody);
  expect(csvResponse.headers.get("Content-Type")).toStartWith("text/csv");
  expect(csvResponse.headers.get("Content-Disposition")).toBe('attachment; filename="nexa-reconciliation.csv"');
  expect(csvBody).toContain('"ref,""line\n2"');
  for (const output of [jsonBody, transactionsBody, csvBody]) {
    expect(output).not.toContain(token);
    expect(output).not.toContain("private-account");
    expect(output).not.toContain("private-comments");
    expect(output).not.toContain("raw-payload-secret");
    expect(output).not.toContain("token-account-secret");
    expect(output).not.toContain("token-name-secret");
    expect(output).not.toContain("review-request-secret");
  }
});

integrationTest("reconciliation alert query selects only due or aged actionable rows", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  const now = new Date("2026-09-08T12:00:00.000Z");
  const staleBefore = new Date("2026-09-08T11:59:00.000Z");
  const values = [
    { reference: "failed-due", processingStatus: "FAILED" as const, nextAttemptAt: now, updatedAt: now, failureReason: "payment_amount_mismatch" },
    { reference: "failed-aged", processingStatus: "FAILED" as const, nextAttemptAt: null, updatedAt: new Date("2026-09-08T11:00:00.000Z"), failureReason: "application_processing_failed" },
    { reference: "manual", processingStatus: "MANUAL_REVIEW" as const, nextAttemptAt: null, updatedAt: now, failureReason: "application_processing_failed" },
    { reference: "review-aged", processingStatus: "REVIEW_PENDING" as const, nextAttemptAt: null, updatedAt: new Date("2026-09-08T11:00:00.000Z"), failureReason: "payment_amount_mismatch" },
    { reference: "failed-future", processingStatus: "FAILED" as const, nextAttemptAt: new Date("2026-09-08T13:00:00.000Z"), updatedAt: now, failureReason: "application_processing_failed" },
    { reference: "review-fresh", processingStatus: "REVIEW_PENDING" as const, nextAttemptAt: null, updatedAt: now, failureReason: null },
  ];
  for (const value of values) {
    await db.insert(nexaPaymentTransactions).values({
      ...value,
      amount: "1.00",
      bank: "",
      comments: "",
      currency: "GTQ",
      account: "",
      token: "",
      tokenDate: now.toISOString(),
      tokenIdentifier: "000000001",
      tokenName: "",
      tokenPrefix: "1234567",
      wasReturn: 0,
      transactionId: value.reference,
      rawPayload: {},
    });
  }

  const alerts = await repository.listReconciliationAlerts(now, staleBefore);

  expect(alerts.map(({ alertType, reference, failureReason }) => ({ alertType, reference, failureReason }))).toEqual([
    { alertType: "FAILED_DUE", reference: "failed-due", failureReason: "payment_amount_mismatch" },
    { alertType: "FAILED_AGED", reference: "failed-aged", failureReason: "application_processing_failed" },
    { alertType: "MANUAL_REVIEW", reference: "manual", failureReason: "application_processing_failed" },
    { alertType: "REVIEW_PENDING_AGED", reference: "review-aged", failureReason: "payment_amount_mismatch" },
  ]);
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

integrationTest("uncertain Cartera outcome reaches MANUAL_REVIEW without bank review", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const repository = new DbPaymentTransactionRepository(db);
  await associateToken("10005010", "1234567", 42);
  const stored = await repository.upsertReceived({
    ...transaction,
    reference: "uncertain-outcome",
    transactionId: "7297",
  });
  const references: Array<string | number> = [];
  let now = new Date("2026-09-08T15:30:00.000Z");
  const run = () => runApplicationWorkerOnce({
    repository,
    cartera: {
      applyNexaPayment: async (input) => {
        references.push(input.transaction.reference);
        throw new Error("payment_outcome_uncertain");
      },
    },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  });

  expect(await run()).toBe(true);
  now = new Date("2026-09-08T15:30:02.000Z");
  expect(await run()).toBe(true);
  now = new Date("2026-09-08T15:30:06.000Z");
  expect(await run()).toBe(true);

  const [payment] = await db.select().from(nexaPaymentTransactions)
    .where(eq(nexaPaymentTransactions.id, stored.id));
  expect(payment).toMatchObject({
    processingStatus: "MANUAL_REVIEW",
    attemptCount: 3,
    failureReason: "application_processing_failed",
  });
  expect(references).toEqual(["uncertain-outcome", "uncertain-outcome", "uncertain-outcome"]);
  expect(await db.select().from(nexaReviews)).toHaveLength(0);

  let bankReviews = 0;
  expect(await runReviewWorkerOnce({
    repository: new DbReviewRepository(db),
    nexa: { reviewTransfer: async () => { bankReviews += 1; } },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 10,
  })).toBe(false);
  expect(bankReviews).toBe(0);
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

integrationTest("stale review claimants cannot overwrite replacement success or failure", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const claimedAt = new Date("2026-09-08T17:30:00.000Z");
  const reclaimedAt = new Date("2026-09-08T17:30:11.000Z");

  const successful = await queuedReview("review-fence-success", "9201");
  const oldSuccess = await successful.repository.claimNextReview(claimedAt, 10);
  const replacementSuccess = await successful.repository.claimNextReview(reclaimedAt, 10);
  if (!oldSuccess || !replacementSuccess) throw new Error("review claims were not created");
  await successful.repository.completeReview(replacementSuccess, { reference: 9201, status: "APPROVED" }, reclaimedAt);
  await successful.repository.failReview(oldSuccess, null, new Date("2026-09-08T17:30:12.000Z"));
  const [successfulPayment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, successful.paymentId));
  const [successfulReview] = await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, successful.paymentId));
  expect(successfulPayment?.processingStatus).toBe("COMPLETED");
  expect(successfulReview).toMatchObject({ attempts: 2, lastError: null, responsePayload: { reference: 9201, status: "APPROVED" } });
  expect(successfulReview?.completedAt).toEqual(reclaimedAt);

  const failed = await queuedReview("review-fence-failure", "9202");
  const oldFailure = await failed.repository.claimNextReview(claimedAt, 10);
  const replacementFailure = await failed.repository.claimNextReview(reclaimedAt, 10);
  if (!oldFailure || !replacementFailure) throw new Error("review claims were not created");
  await failed.repository.failReview(replacementFailure, null, reclaimedAt);
  await failed.repository.completeReview(oldFailure, { reference: 9202, status: "APPROVED" }, new Date("2026-09-08T17:30:12.000Z"));
  const [failedPayment] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, failed.paymentId));
  const [failedReview] = await db.select().from(nexaReviews).where(eq(nexaReviews.transactionId, failed.paymentId));
  expect(failedPayment?.processingStatus).toBe("MANUAL_REVIEW");
  expect(failedReview).toMatchObject({ attempts: 2, lastError: "review_processing_failed", responsePayload: null });
  expect(failedReview?.completedAt).toEqual(reclaimedAt);
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
  const claim = await transactions.claimNextApplication(new Date("2026-09-08T12:00:00.000Z"), 10);
  if (!claim) throw new Error("application claim was not created");
  await transactions.finalizeApplication(stored.id, {
    paymentId: 900,
    reviewStatus: "APPROVED",
    failureReason: null,
  }, new Date("2026-09-08T12:00:00.000Z"), claim.attemptCount);
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
