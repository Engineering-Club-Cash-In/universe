import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// La 0049 desactiva y encola los bindings activos de créditos que ya estaban
// CANCELADO antes del despliegue (el código nuevo solo actúa en cancelaciones
// futuras). Se aplica la migración real dos veces contra Postgres.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

const migracion = readFileSync(new URL("../../drizzle/0049_nexa_outbox.sql", import.meta.url), "utf8");
let sql: ReturnType<typeof postgres> | undefined;

afterAll(async () => {
  await sql?.end();
});

integrationTest("0049 desactiva y encola solo los bindings activos de créditos CANCELADO, sin duplicar al repetirla", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => {} });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, "statusCredit" text)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
    activo boolean NOT NULL DEFAULT true)`;
  // 1: CANCELADO activo · 2: ACTIVO activo · 3: CANCELADO ya inactivo
  await sql`INSERT INTO cartera.creditos VALUES (1, 'CANCELADO'), (2, 'ACTIVO'), (3, 'CANCELADO')`;
  await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (1, true), (2, true), (3, false)`;

  await sql.unsafe(migracion);
  await sql.unsafe(migracion);

  const bindings = await sql`SELECT credito_id, activo FROM cartera.nexa_credit_bindings ORDER BY credito_id`;
  expect(bindings.map((b) => [b.credito_id, b.activo])).toEqual([[1, false], [2, true], [3, false]]);

  const eventos = await sql`SELECT tipo, credito_id, payload, enviado_at FROM cartera.nexa_outbox ORDER BY id`;
  expect(eventos.map((e) => ({ ...e }))).toEqual([
    { tipo: "credit_cancelled", credito_id: 1, payload: { creditoId: 1 }, enviado_at: null },
  ]);
});
