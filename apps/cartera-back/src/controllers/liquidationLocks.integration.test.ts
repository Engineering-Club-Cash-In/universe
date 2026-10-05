import { expect, test } from "bun:test";
import { Pool } from "pg";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

integrationTest("advisory lock y FOR UPDATE excluyen operaciones concurrentes", async () => {
  const lockSource = await Bun.file(
    new URL("../utils/creditoEspejoLock.ts", import.meta.url),
  ).text();
  const namespace = Number(
    lockSource.match(/ESPEJO_ADVISORY_LOCK_NAMESPACE = (\d+)/)?.[1],
  );
  expect(namespace).toBeInteger();
  const pool = new Pool(parseTestDatabaseUrl(testDatabaseUrl!));
  const first = await pool.connect();
  const second = await pool.connect();

  try {
    await first.query("DROP SCHEMA IF EXISTS cartera CASCADE");
    await first.query("CREATE SCHEMA cartera");
    await first.query(
      "CREATE TABLE cartera.inversionistas (inversionista_id integer PRIMARY KEY)",
    );
    await first.query("INSERT INTO cartera.inversionistas VALUES (1)");

    await first.query("SELECT pg_advisory_lock($1, $2)", [
      namespace,
      10,
    ]);
    expect(
      await second.query("SELECT pg_try_advisory_lock($1, $2) AS ok", [
        namespace,
        10,
      ]),
    ).toMatchObject({ rows: [{ ok: false }] });
    await first.query("SELECT pg_advisory_unlock($1, $2)", [
      namespace,
      10,
    ]);

    await first.query("BEGIN");
    await first.query(
      "SELECT * FROM cartera.inversionistas WHERE inversionista_id = 1 FOR UPDATE",
    );
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '100ms'");
    await expect(
      second.query(
        "UPDATE cartera.inversionistas SET inversionista_id = 1 WHERE inversionista_id = 1",
      ),
    ).rejects.toThrow("lock timeout");
    await second.query("ROLLBACK");
    await first.query("COMMIT");
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);
    await second.query("ROLLBACK").catch(() => undefined);
    await first.query("DROP SCHEMA IF EXISTS cartera CASCADE");
    first.release();
    second.release();
    await pool.end();
  }
});
