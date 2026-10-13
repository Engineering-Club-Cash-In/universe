import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Un pago Nexa sobre un crédito con mora activa: el candado del binding
// (`withPaymentBindingLock`) sostiene `FOR KEY SHARE` sobre la fila del crédito
// en la conexión del advisory lock, y adentro `updateMora` —por el pool
// global, OTRA conexión— candea esa misma fila. Con `FOR UPDATE` esperaba a
// una transacción que a su vez esperaba a que el trabajo terminara: cuelgue
// entre conexiones que Postgres no ve como deadlock. Solo SQL real con dos
// sesiones lo muestra.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{
  sql: Sql;
  latefee: typeof import("./latefee");
  lock: typeof import("../utils/paymentAdvisoryLock");
  database: typeof import("../database");
}> | undefined;
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY,
    numero_credito_sifco text UNIQUE, "statusCredit" text)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id))`;
  await sql`CREATE TABLE cartera.moras_credito (mora_id serial PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id),
    activa boolean NOT NULL DEFAULT true, porcentaje_mora numeric(5,2) NOT NULL DEFAULT 1.12,
    monto_mora numeric(18,2) NOT NULL DEFAULT 0, cuotas_atrasadas integer NOT NULL DEFAULT 0,
    created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`;
  await sql`CREATE TABLE cartera.moras_historial (historial_id serial PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id), mora_id integer,
    tipo_evento text NOT NULL, origen text NOT NULL,
    monto_anterior numeric(18,2) NOT NULL DEFAULT 0, monto_nuevo numeric(18,2) NOT NULL DEFAULT 0,
    cuotas_atrasadas_anterior integer NOT NULL DEFAULT 0, cuotas_atrasadas_nuevas integer NOT NULL DEFAULT 0,
    capital_credito numeric(18,2), porcentaje_mora numeric(5,4), usuario_id integer, motivo text,
    pago_id integer, fecha timestamp NOT NULL DEFAULT now())`;
  for (const id of [1, 2]) {
    await sql`INSERT INTO cartera.creditos VALUES (${id}, ${`S-${id}`}, 'MOROSO')`;
    await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id})`;
    await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas)
      VALUES (${id}, 100, 1)`;
  }
  return {
    sql,
    database: await import("../database"),
    latefee: await import("./latefee"),
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
const decremento = (latefee: typeof import("./latefee"), creditoId: number, monto: number) =>
  latefee.updateMora({ credito_id: creditoId, tipo: "DECREMENTO", monto_cambio: monto, motivo: "pago nexa" });

integrationTest("con el candado del binding sostenido, updateMora del mismo crédito termina (no se cuelga)", async () => {
  const { sql, latefee, lock } = await setup();
  const pago = lock.withPaymentAdvisoryLock(1, (paymentLock) =>
    lock.withPaymentBindingLock(paymentLock, 1, async (bindingExists) => {
      expect(bindingExists).toBe(true);
      return decremento(latefee, 1, 100);
    }));
  const desenlace = await Promise.race([pago.then(() => "termino"), sleep(5_000).then(() => "colgado")]);
  if (desenlace === "colgado") {
    // Desarma el cuelgue para que la prueba falle limpia y no deje sesiones vivas.
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await pago.catch(() => undefined);
  }
  expect(desenlace).toBe("termino");
  expect((await pago).success).toBe(true);
  const [mora] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 1`;
  const [credito] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 1`;
  const eventos = await sql`SELECT tipo_evento FROM cartera.moras_historial WHERE credito_id = 1`;
  expect(mora).toEqual({ monto_mora: "0.00", activa: false });
  expect(credito!.statusCredit).toBe("ACTIVO");
  expect(eventos.map((e) => e.tipo_evento)).toEqual(["DECREMENTO"]);
});

integrationTest("updateMora sigue esperando a quien ESCRIBE el crédito (convenio/cron): el orden de candados se conserva", async () => {
  const { sql, latefee } = await setup();
  let soltar!: () => void;
  const compuerta = new Promise<void>((r) => (soltar = r));
  let escribio!: () => void;
  const yaEscribio = new Promise<void>((r) => (escribio = r));
  // Como `createPaymentAgreement`: UPDATE de `creditos` primero, transacción abierta.
  const convenio = sql.begin(async (tx) => {
    await tx.unsafe(`UPDATE cartera.creditos SET "statusCredit" = 'EN_CONVENIO' WHERE credito_id = 2`);
    escribio();
    await compuerta;
  });
  await yaEscribio;
  const ajuste = decremento(latefee, 2, 40);
  const antes = await Promise.race([ajuste.then(() => "termino"), sleep(500).then(() => "espera")]);
  expect(antes).toBe("espera");
  soltar();
  await convenio;
  expect((await ajuste).success).toBe(true);
  const [mora] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 2`;
  const [credito] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 2`;
  expect(mora!.monto_mora).toBe("60.00");
  // Leyó el estado DESPUÉS del convenio (el candado va antes de la lectura):
  // no pisa EN_CONVENIO con MOROSO.
  expect(credito!.statusCredit).toBe("EN_CONVENIO");
});
