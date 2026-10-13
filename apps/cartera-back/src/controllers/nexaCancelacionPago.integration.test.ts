import { afterAll, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Cancelar un crédito mientras un pago Nexa está en vuelo, con SQL real y
// varias conexiones. El pago sostiene el binding (`withPaymentBindingLock`:
// FOR UPDATE en la conexión del advisory lock) y su trabajo escribe `creditos`
// por el pool global; la cancelación escribe `creditos` y después el binding.
// Sin serializar, cada lado espera al otro a través de una conexión "idle in
// transaction": Postgres no lo detecta como deadlock y se cuelga para siempre.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{
  sql: Sql;
  credits: typeof import("./credits");
  lock: typeof import("../utils/paymentAdvisoryLock");
  database: typeof import("../database");
}> | undefined;
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY ||= "test";
  process.env.EMAIL_DOMAIN ||= "test.local";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, "statusCredit" text)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
    activo boolean NOT NULL DEFAULT true, nexa_token varchar(32))`;
  await sql`CREATE TABLE cartera.nexa_outbox (id bigserial PRIMARY KEY, event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tipo varchar(40) NOT NULL, credito_id integer NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb)`;
  await sql`CREATE TABLE cartera.credit_cancelations (id serial PRIMARY KEY,
    credit_id integer NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
    motivo text NOT NULL, observaciones text, fecha_cancelacion timestamp DEFAULT now(),
    monto_cancelacion numeric(18,2) NOT NULL, activo boolean NOT NULL DEFAULT false,
    traspaso numeric(18,2) DEFAULT 0, garantia_mobiliaria numeric(18,2) DEFAULT 0,
    otros numeric(18,2) DEFAULT 0, cuotas_atrasadas integer NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now())`;
  await sql`CREATE TABLE cartera.bad_debts (id serial PRIMARY KEY, credit_id integer NOT NULL)`;
  await sql`CREATE TABLE cartera.montos_adicionales (id serial PRIMARY KEY, credit_id integer NOT NULL)`;
  await sql`INSERT INTO cartera.creditos VALUES (1, 'ACTIVO')`;
  await sql`INSERT INTO cartera.nexa_credit_bindings (credito_id, nexa_token) VALUES (1, '1111222233334444')`;
  return {
    sql,
    database: await import("../database"),
    credits: await import("./credits"),
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

integrationTest("cancelar con un pago Nexa sosteniendo el binding: espera al pago y no se cuelga", async () => {
  const { sql, credits, lock, database } = await setup();
  let soltar!: () => void;
  const compuerta = new Promise<void>((r) => (soltar = r));
  let tomado!: () => void;
  const bindingTomado = new Promise<void>((r) => (tomado = r));

  // Como processNexaPayment: advisory lock → binding FOR UPDATE → el registro
  // del pago escribe `creditos` por el pool global (otra conexión).
  const pago = lock.withPaymentAdvisoryLock(1, (paymentLock) =>
    lock.withPaymentBindingLock(paymentLock, 1, async () => {
      tomado();
      await compuerta;
      await database.db.execute(
        dsql`UPDATE cartera.creditos SET "statusCredit" = "statusCredit" WHERE credito_id = 1`,
      );
    }));
  await bindingTomado;

  const cancelacion = credits.actualizarEstadoCredito({
    creditId: 1,
    accion: "CANCELAR",
    motivo: "Cancelación total",
    monto_cancelacion: 100,
  });
  await sleep(400); // sin candado, la cancelación ya escribió `creditos` y espera el binding
  soltar();

  const desenlace = await Promise.race([
    Promise.all([pago, cancelacion]).then(() => "termino"),
    sleep(5_000).then(() => "colgado"),
  ]);
  if (desenlace === "colgado") {
    // Desarma el cuelgue para que la prueba falle limpia y no deje sesiones vivas.
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await Promise.allSettled([pago, cancelacion]);
  }
  expect(desenlace).toBe("termino");
  expect((await cancelacion).ok).toBe(true);

  const [credito] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 1`;
  const [binding] = await sql`SELECT activo FROM cartera.nexa_credit_bindings WHERE credito_id = 1`;
  const eventos = await sql`SELECT tipo FROM cartera.nexa_outbox WHERE credito_id = 1`;
  expect(credito!.statusCredit).toBe("CANCELADO");
  expect(binding!.activo).toBe(false);
  expect(eventos.map((e) => e.tipo)).toEqual(["credit_cancelled"]);
});

integrationTest("ACTIVAR no reactiva un crédito CANCELADO; sí uno en PENDIENTE_CANCELACION", async () => {
  const { sql, credits } = await setup();
  await sql`INSERT INTO cartera.creditos VALUES (2, 'CANCELADO'), (3, 'PENDIENTE_CANCELACION')`;
  await sql`INSERT INTO cartera.credit_cancelations (credit_id, motivo, monto_cancelacion) VALUES (2, 'x', 1), (3, 'x', 1)`;

  const cancelado = await credits.actualizarEstadoCredito({ creditId: 2, accion: "ACTIVAR" });
  expect(cancelado).toEqual({ ok: false, message: "Un crédito CANCELADO no se puede reactivar ni cambiar de estado." });
  const [c2] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 2`;
  const cierre2 = await sql`SELECT 1 FROM cartera.credit_cancelations WHERE credit_id = 2`;
  expect(c2!.statusCredit).toBe("CANCELADO");
  expect(cierre2.length).toBe(1); // no borró el registro de cancelación

  const pendiente = await credits.actualizarEstadoCredito({ creditId: 3, accion: "ACTIVAR" });
  expect(pendiente.ok).toBe(true);
  const [c3] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 3`;
  expect(c3!.statusCredit).toBe("ACTIVO");
});

integrationTest("un CANCELADO no cambia de estado por ninguna acción (rodeo vía PENDIENTE_CANCELACION, INCOBRABLE, CANCELAR de nuevo)", async () => {
  const { sql, credits } = await setup();
  await sql`INSERT INTO cartera.creditos VALUES (4, 'CANCELADO')`;
  await sql`INSERT INTO cartera.nexa_credit_bindings (credito_id, nexa_token, activo) VALUES (4, '5555666677778888', false)`;
  await sql`INSERT INTO cartera.credit_cancelations (credit_id, motivo, monto_cancelacion) VALUES (4, 'orig', 1)`;
  const mensaje = "Un crédito CANCELADO no se puede reactivar ni cambiar de estado.";
  const foto = async () => JSON.stringify({
    c: await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 4`,
    b: await sql`SELECT activo FROM cartera.nexa_credit_bindings WHERE credito_id = 4`,
    k: await sql`SELECT id, motivo FROM cartera.credit_cancelations WHERE credit_id = 4 ORDER BY id`,
    o: await sql`SELECT id FROM cartera.nexa_outbox WHERE credito_id = 4`,
  });
  const antes = await foto();

  for (const accion of ["PENDIENTE_CANCELACION", "INCOBRABLE", "CANCELAR", "EN_CONVENIO", "MOROSO", "ACTIVAR"] as const) {
    const r = await credits.actualizarEstadoCredito({
      creditId: 4, accion, motivo: "otro", monto_cancelacion: 50,
    });
    expect(r).toEqual({ ok: false, message: mensaje });
    expect(await foto()).toBe(antes);
  }
  expect(JSON.parse(antes).c[0].statusCredit).toBe("CANCELADO");
});
