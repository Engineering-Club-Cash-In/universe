import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const expectRejected = async (promise: PromiseLike<unknown>, message?: string) => {
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    rejected = true;
    if (message) {
      expect(error instanceof Error ? error.message : String(error)).toContain(message);
    }
  }
  expect(rejected).toBe(true);
};

integrationTest("constraints Nexa resisten concurrencia, replay y rollback", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  const migration = await Bun.file(
    new URL("../../drizzle/0035_add_nexa_internal_payments.sql", import.meta.url),
  ).text();

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;
    await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY)`;
    await sql`CREATE TABLE cartera.pagos_credito (pago_id integer PRIMARY KEY)`;
    await sql`INSERT INTO cartera.creditos VALUES (10)`;
    await sql.unsafe(migration).simple();
    await sql.unsafe(migration).simple();

    await sql`INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ('nonce-persisted')`;
    await expectRejected(
      sql`INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ('nonce-persisted')`,
    );

    const insert = (reference: string, nonce: string) => sql`
      INSERT INTO cartera.nexa_payment_events
        (external_reference, nonce, credito_id, amount, currency, payload_hash)
      VALUES (${reference}, ${nonce}, 10, 10.00, 'GTQ', ${"a".repeat(64)})
    `;
    const concurrent = await Promise.allSettled([
      insert("qa-concurrent", "nonce-concurrent-1"),
      insert("qa-concurrent", "nonce-concurrent-2"),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expectRejected(insert("qa-replay", "nonce-concurrent-1"));

    await expectRejected(sql.begin(async (transaction) => {
      await transaction.unsafe(`
        INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ('nonce-rollback')
      `);
      await transaction.unsafe(`
        INSERT INTO cartera.nexa_payment_events
          (external_reference, nonce, credito_id, amount, currency, payload_hash)
        VALUES ('qa-rollback', 'nonce-rollback', 10, 10.00, 'GTQ', $1)
      `, ["b".repeat(64)]);
      throw new Error("force rollback");
    }), "force rollback");
    const rolledBack = await sql`
      SELECT id FROM cartera.nexa_payment_events WHERE external_reference = 'qa-rollback'
    `;
    expect(rolledBack).toHaveLength(0);
    const rolledBackNonce = await sql`
      SELECT nonce FROM cartera.nexa_payment_nonces WHERE nonce = 'nonce-rollback'
    `;
    expect(rolledBackNonce).toHaveLength(0);
  } finally {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);
