import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TokenTransaction } from "../nexa/schemas";
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

function safeTestDatabaseUrl(value: string) {
  const url = new URL(value);
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) || url.pathname !== "/nexa_inbox_test") {
    throw new Error("TEST_DATABASE_URL must target local database nexa_inbox_test");
  }
  return value;
}
