import { afterAll, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Carrera cancelar crédito vs registrar token de Nexa, con SQL real y dos
// conexiones: los mocks no pueden mostrar el bloqueo entre sesiones.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{ sql: Sql; tokens: typeof import("./nexaTokenRuntime"); canc: typeof import("./nexaCancelacion"); database: typeof import("../database"); lock: typeof import("../utils/paymentAdvisoryLock") }> | undefined;
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, "statusCredit" text)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
    activo boolean NOT NULL DEFAULT true, nexa_token varchar(32), nexa_identifier varchar(9),
    nexa_user_id integer, token_registrado_at timestamptz)`;
  await sql`CREATE UNIQUE INDEX uq_nexa_credit_bindings_token ON cartera.nexa_credit_bindings (nexa_token) WHERE nexa_token IS NOT NULL`;
  await sql`CREATE TABLE cartera.nexa_outbox (id bigserial PRIMARY KEY, event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tipo varchar(40) NOT NULL, credito_id integer NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb)`;
  // Alarga el INSERT del binding del crédito 2 para que el registro quede "en vuelo" ya con su candado.
  await sql`CREATE FUNCTION cartera.lento() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.credito_id = 2 THEN PERFORM pg_sleep(0.8); END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER lento BEFORE INSERT ON cartera.nexa_credit_bindings FOR EACH ROW EXECUTE FUNCTION cartera.lento()`;
  await sql`INSERT INTO cartera.creditos VALUES (1, 'ACTIVO'), (2, 'ACTIVO'), (3, 'ACTIVO'), (4, 'ACTIVO')`;
  await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (3, true, 'tok3', 'ID1', 7, now())`;
  const database = await import("../database");
  return {
    sql,
    database,
    tokens: await import("./nexaTokenRuntime"),
    canc: await import("./nexaCancelacion"),
    lock: await import("../utils/paymentAdvisoryLock"),
  };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql, database } = await ready;
  await sql.end();
  await database.client.end();
  await database.lockPool.end();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const body = (creditoId: number) => ({ creditoId, token: `tok${creditoId}`, identifier: "ID1", nexaUserId: 7 });
const estado = async (sql: Sql, id: number) => {
  const [c] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = ${id}`;
  const b = await sql`SELECT activo FROM cartera.nexa_credit_bindings WHERE credito_id = ${id}`;
  const o = await sql`SELECT 1 FROM cartera.nexa_outbox WHERE credito_id = ${id}`;
  return { status: c!.statusCredit, binding: b.map((r) => r.activo), eventos: o.length };
};

integrationTest("(a) la cancelación va primero: el registro espera y el binding no nace activo", async () => {
  const { sql, tokens, canc, database } = await setup();
  let soltar!: () => void;
  const compuerta = new Promise<void>((r) => (soltar = r));
  let cancelado!: () => void;
  const yaCancelo = new Promise<void>((r) => (cancelado = r));
  const cancelacion = database.db.transaction(async (tx) => {
    await tx.execute(dsql`UPDATE cartera.creditos SET "statusCredit" = 'CANCELADO' WHERE credito_id = 1`);
    cancelado();
    await compuerta;
    await canc.desactivarNexaPorCancelacion(tx, 1);
  });
  await yaCancelo;
  const registro = tokens.nexaTokenDependencies.upsertToken(body(1));
  const antes = await Promise.race([registro.then(() => "termino"), sleep(400).then(() => "espera")]);
  expect(antes).toBe("espera");
  soltar();
  await cancelacion;
  expect(await registro).toBe("credit_cancelled");
  const e = await estado(sql, 1);
  expect(e.status).toBe("CANCELADO");
  expect(e.binding.every((a) => a === false)).toBe(true);
});

integrationTest("(b) el registro va primero: la cancelación espera, ve el binding, lo desactiva y encola", async () => {
  const { sql, tokens, canc, database } = await setup();
  const registro = tokens.nexaTokenDependencies.upsertToken(body(2));
  await sleep(250); // el registro ya leyó el crédito y sigue en vuelo (trigger lento)
  await database.db.transaction(async (tx) => {
    await tx.execute(dsql`UPDATE cartera.creditos SET "statusCredit" = 'CANCELADO' WHERE credito_id = 2`);
    await canc.desactivarNexaPorCancelacion(tx, 2);
  });
  expect(await registro).toBe("created");
  const e = await estado(sql, 2);
  expect(e).toEqual({ status: "CANCELADO", binding: [false], eventos: 1 });
});

integrationTest("(c) un re-registro durante un pago Nexa del mismo crédito espera al pago y no lo cuelga", async () => {
  const { sql, tokens, database, lock } = await setup();
  let sostiene!: () => void;
  const yaSostiene = new Promise<void>((r) => (sostiene = r));
  let registro: Promise<string> | undefined;
  // Igual que nexaPaymentDependencies.withCreditLock: advisory, y en esa conexión
  // KEY SHARE del crédito + FOR UPDATE del binding; el trabajo escribe `creditos`
  // por OTRA conexión (el pool de trabajo).
  const pago = lock.withPaymentAdvisoryLock(3, (paymentLock) => lock.withPaymentBindingLock(paymentLock, 3, async () => {
    sostiene();
    await sleep(300); // el re-registro ya entró
    await database.client.query(`UPDATE cartera.creditos SET "statusCredit" = 'ACTIVO' WHERE credito_id = 3`);
    return "pago:ok";
  }));
  await yaSostiene;
  registro = tokens.nexaTokenDependencies.upsertToken(body(3)).then((r) => `registro:${r}`);
  try {
    const desenlace = await Promise.race([pago, sleep(3000).then(() => "pago:COLGADO")]);
    expect(desenlace).toBe("pago:ok");
    expect(await registro).toBe("registro:unchanged");
  } finally {
    // Sin el arreglo nadie avanza: se cancela al registro para no colgar el runner.
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%nexa_credit_bindings%'`;
    await Promise.allSettled([pago, registro]);
  }
}, 10_000);

integrationTest("(d) con la cancelación bajo el candado de pagos, el registro espera y el binding no nace activo", async () => {
  const { sql, tokens, canc, database, lock } = await setup();
  let soltar!: () => void;
  const compuerta = new Promise<void>((r) => (soltar = r));
  let cancelado!: () => void;
  const yaCancelo = new Promise<void>((r) => (cancelado = r));
  // Como conCandadoDePagos en credits.ts.
  const cancelacion = lock.withPaymentAdvisoryLock(4, () => database.db.transaction(async (tx) => {
    await tx.execute(dsql`UPDATE cartera.creditos SET "statusCredit" = 'CANCELADO' WHERE credito_id = 4`);
    cancelado();
    await compuerta;
    await canc.desactivarNexaPorCancelacion(tx, 4);
  }));
  await yaCancelo;
  const registro = tokens.nexaTokenDependencies.upsertToken(body(4));
  const antes = await Promise.race([registro.then(() => "termino"), sleep(400).then(() => "espera")]);
  expect(antes).toBe("espera");
  soltar();
  await cancelacion;
  expect(await registro).toBe("credit_cancelled");
  const e = await estado(sql, 4);
  expect(e.status).toBe("CANCELADO");
  expect(e.binding).toEqual([false]);
});
