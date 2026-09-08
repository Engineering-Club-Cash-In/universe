import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TokenTransaction } from "../nexa/schemas";
import { runApplicationWorkerOnce } from "../payments/application-worker";
import { DbPaymentTransactionRepository } from "./repositories";
import * as schema from "./schema";
import { nexaPaymentTransactions } from "./schema";

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
  await db.delete(nexaPaymentTransactions);
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
    process: async () => { throw new Error("token=1234567310005010 sensitive comment"); },
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

  const successful = await repository.upsertReceived({
    ...transaction,
    reference: "worker-2",
    transactionId: "7294",
  });
  let processedReference = "";
  expect(await runApplicationWorkerOnce({
    repository,
    process: async (claim) => { processedReference = claim.reference; },
    now: () => now,
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 2,
    maxBackoffSeconds: 3,
  })).toBe(true);
  expect(processedReference).toBe("worker-2");
  const [applied] = await db.select().from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.id, successful.id));
  expect(applied).toMatchObject({ processingStatus: "APPLIED", attemptCount: 1, failureReason: null });
  expect(applied?.rawPayload).not.toHaveProperty("token");
});

function safeTestDatabaseUrl(value: string) {
  const url = new URL(value);
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) || url.pathname !== "/nexa_inbox_test") {
    throw new Error("TEST_DATABASE_URL must target local database nexa_inbox_test");
  }
  return value;
}
