import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { DbCarteraEventTokenUserRepository } from "./cartera-events-repository";
import * as schema from "./schema";
import { nexaPaymentTokens, nexaTokenUsers } from "./schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const pool = testDatabaseUrl ? new Pool({ connectionString: safeTestDatabaseUrl(testDatabaseUrl), max: 2 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

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

integrationTest("deactivates only the cancelled credit's active token user, idempotently", async () => {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const [paymentToken] = await db.insert(nexaPaymentTokens).values({
    nexaTokenId: 900, prefix: "1234567", account: "acc", name: "name",
  }).returning();
  if (!paymentToken) throw new Error("payment token was not created");
  const base = { paymentTokenId: paymentToken.id, description: "d", nationalId: "1" };
  await db.insert(nexaTokenUsers).values([
    { ...base, nexaUserId: 1, creditoId: 9234, identifier: "000009234", token: "1234567000009234" },
    { ...base, nexaUserId: 2, creditoId: 9235, identifier: "000009235", token: "1234567000009235" },
  ]);

  const repository = new DbCarteraEventTokenUserRepository(db);
  expect(await repository.deactivateByCreditoId(9234)).toBe(1);
  expect(await repository.deactivateByCreditoId(9234)).toBe(0);
  expect(await repository.deactivateByCreditoId(1)).toBe(0);

  const [cancelled] = await db.select().from(nexaTokenUsers).where(eq(nexaTokenUsers.creditoId, 9234));
  const [other] = await db.select().from(nexaTokenUsers).where(eq(nexaTokenUsers.creditoId, 9235));
  expect(cancelled?.active).toBe(false);
  expect(other?.active).toBe(true);
});

function safeTestDatabaseUrl(value: string) {
  const url = new URL(value);
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) || url.pathname !== "/nexa_inbox_test") {
    throw new Error("TEST_DATABASE_URL must target local database nexa_inbox_test");
  }
  return value;
}
