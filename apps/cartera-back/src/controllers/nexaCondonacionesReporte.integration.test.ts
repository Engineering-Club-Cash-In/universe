import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Reporte de condonaciones con SQL real: separa las automáticas Nexa de las manuales.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{ sql: Sql; latefee: typeof import("./latefee"); database: typeof import("../database") }> | undefined;
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.usuarios (usuario_id integer PRIMARY KEY, nombre text)`;
  await sql`CREATE TABLE cartera.asesores (asesor_id integer PRIMARY KEY, nombre text)`;
  await sql`CREATE TABLE cartera.platform_users (id integer PRIMARY KEY, email text)`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, usuario_id integer, asesor_id integer,
    numero_credito_sifco text, "statusCredit" text, capital numeric(18,2))`;
  await sql`CREATE TABLE cartera.moras_condonaciones (condonacion_id serial PRIMARY KEY, credito_id integer, mora_id integer,
    motivo text, monto_condonacion numeric(18,2), usuario_id integer, fecha timestamp NOT NULL DEFAULT now(),
    nexa_payment_event_id integer, anulada_at timestamptz)`;
  await sql`INSERT INTO cartera.usuarios VALUES (1, 'Cliente')`;
  await sql`INSERT INTO cartera.asesores VALUES (1, 'Asesor')`;
  await sql`INSERT INTO cartera.platform_users VALUES (1, 'a@x.com')`;
  await sql`INSERT INTO cartera.creditos VALUES (1, 1, 1, 'S-1', 'ACTIVO', 1000)`;
  await sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, monto_condonacion, usuario_id, nexa_payment_event_id, anulada_at) VALUES
    (1, 1, 'Cliente en convenio', 50, 1, NULL, NULL),
    (1, 1, 'NEXA_ACH_A_TIEMPO', 7.47, 1, 501, NULL),
    (1, 1, 'NEXA_ACH_A_TIEMPO', 99, 1, 502, now())`;
  return { sql, latefee: await import("./latefee"), database: await import("../database") };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql, database } = await ready;
  await sql.end();
  await database.client.end();
  await database.lockPool.end();
});

integrationTest("separa automáticas y manuales, marca cada fila y ignora las anuladas", async () => {
  const { latefee } = await setup();
  const r: any = await latefee.getCondonacionesMora({ page: 1, pageSize: 50 });
  expect(r.totales).toEqual({ monto_total: "57.47", monto_total_manual: "50.00", monto_total_automatica: "7.47", condonaciones: 2 });
  const por = Object.fromEntries(r.data.map((f: any) => [f.motivo, f]));
  expect(por["NEXA_ACH_A_TIEMPO"]).toMatchObject({ automatica: true, motivo_texto: "Pago Nexa a tiempo (ACH)" });
  expect(por["Cliente en convenio"]).toMatchObject({ automatica: false, motivo_texto: "Cliente en convenio" });
});

integrationTest("sin automáticas el total automático es 0.00", async () => {
  const { sql, latefee } = await setup();
  await sql`DELETE FROM cartera.moras_condonaciones WHERE nexa_payment_event_id IS NOT NULL`;
  const r: any = await latefee.getCondonacionesMora({ page: 1, pageSize: 50 });
  expect(r.totales).toMatchObject({ monto_total: "50.00", monto_total_manual: "50.00", monto_total_automatica: "0.00" });
});
