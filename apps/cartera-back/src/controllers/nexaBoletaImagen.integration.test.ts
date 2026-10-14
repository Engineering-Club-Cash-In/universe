import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Postgres real: el registro de la boleta-imagen se serializa con un advisory
// lock por pago; dos registros a la vez (disparo + barrido) no pueden duplicar.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

const migracion = (archivo: string) => Bun.file(new URL(`../../drizzle/${archivo}`, import.meta.url)).text();

const setup = async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.usuarios (usuario_id integer PRIMARY KEY, nombre varchar(200) NOT NULL)`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, usuario_id integer, numero_credito_sifco varchar(40))`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer,
    monto_boleta numeric(18,2), fecha_boleta date, numeroautorizacion varchar(100),
    "paymentFalse" boolean NOT NULL DEFAULT false)`;
  await sql`CREATE TABLE cartera.boletas (id serial PRIMARY KEY,
    pago_id integer NOT NULL REFERENCES cartera.pagos_credito (pago_id), url_boleta varchar(255) NOT NULL)`;
  // La migración real: nexa_payment_events y pagos_credito.nexa_payment_event_id.
  await sql.unsafe(await migracion("0039_add_nexa_internal_payments.sql")).simple();
  await sql`INSERT INTO cartera.usuarios VALUES (5, 'Cliente Prueba')`;
  await sql`INSERT INTO cartera.creditos VALUES (1, 5, '0101')`;
  const { boletaNexaDeps } = await import("./nexaBoletaImagen");
  return { sql, deps: boletaNexaDeps };
};

let referencia = 0;
const pago = async (sql: postgres.Sql, { nexa = true, anulado = false, estado = "billing_pending" } = {}) => {
  let eventoId: number | null = null;
  if (nexa) {
    referencia += 1;
    const [e] = await sql`INSERT INTO cartera.nexa_payment_events
        (external_reference, nonce, credito_id, amount, currency, payload_hash, status)
      VALUES (${`ref-${referencia}`}, ${`nonce-${referencia}`}, 1, 2500.50, 'GTQ', ${"a".repeat(64)}, ${estado})
      RETURNING id`;
    eventoId = e!.id;
  }
  const [p] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, monto_boleta, fecha_boleta, numeroautorizacion, "paymentFalse", nexa_payment_event_id)
    VALUES (1, 2500.5, '2026-10-01', '36418016', ${anulado}, ${eventoId}) RETURNING pago_id`;
  return p!.pago_id as number;
};

integrationTest("pendientes/datos/registrar: solo pagos Nexa vivos de un evento aplicado y sin boleta, y dos registros a la vez dejan una fila", async () => {
  const { sql, deps } = await setup();
  const vivo = await pago(sql);
  const billed = await pago(sql, { estado: "billed" });
  const anulado = await pago(sql, { anulado: true });
  const manual = await pago(sql, { nexa: false });
  const fallido = await pago(sql, { estado: "failed" });
  const revision = await pago(sql, { estado: "manual_review" });
  const procesando = await pago(sql, { estado: "processing" });
  const conBoleta = await pago(sql);
  await sql`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${conBoleta}, 'subida-a-mano.png')`;

  expect(await deps.pendientes(25)).toEqual([vivo, billed]);
  expect(await deps.datos(vivo)).toEqual({
    pagoId: vivo,
    numeroAutorizacion: "36418016",
    monto: "2500.50",
    fechaBoleta: "2026-10-01",
    numeroSifco: "0101",
    cliente: "Cliente Prueba",
  });
  for (const id of [anulado, manual, fallido, revision, procesando, conBoleta]) {
    expect(await deps.datos(id)).toBeNull();
    expect(await deps.registrar(id, "no")).toBe(false);
  }

  const resultados = await Promise.all([deps.registrar(vivo, "u1"), deps.registrar(vivo, "u2")]);
  expect(resultados.filter(Boolean).length).toBe(1);
  expect((await sql`SELECT pago_id FROM cartera.boletas WHERE pago_id = ${vivo}`).length).toBe(1);
  expect(await deps.pendientes(25)).toEqual([billed]);
  await sql.end();
});
