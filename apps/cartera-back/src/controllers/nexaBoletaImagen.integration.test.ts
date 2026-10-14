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
  const { boletaNexaDeps, BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE } = await import("./nexaBoletaImagen");
  return { sql, deps: boletaNexaDeps, BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE };
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
  const { sql, deps, BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE } = await setup();
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

  // Dos registros solapados de verdad (con Promise.all no se solapaban y el test pasaba sin el
  // candado): el primero, en otra conexión, toma el candado e inserta sin commitear; el segundo
  // tiene que quedar esperando y, tras el COMMIT, ver la fila y no insertar otra (no hay índice
  // único en boletas.pago_id: sin el candado quedan dos).
  const primero = await sql.reserve();
  const [{ pid: pidPrimero }] = await primero`SELECT pg_backend_pid() AS pid`;
  await primero`BEGIN`;
  await primero`SELECT pg_advisory_xact_lock(${BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE}, ${vivo})`;
  await primero`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${vivo}, 'u1')`;
  const segundo = deps.registrar(vivo, "u2");
  // No alcanza con "no terminó en N ms" (en CI lento pasa aunque falte el candado): se espera a
  // que PostgreSQL muestre al segundo bloqueado en ESE advisory lock (dos int4 → objsubid = 2).
  let terminado = false;
  segundo.finally(() => { terminado = true; }).catch(() => {});
  const tope = Date.now() + 5_000;
  for (;;) {
    const [{ esperando }] = await sql`SELECT count(*)::int AS esperando FROM pg_locks
      WHERE locktype = 'advisory' AND classid = ${BOLETA_NEXA_ADVISORY_LOCK_NAMESPACE}::oid
        AND objid = ${vivo}::oid AND objsubid = 2 AND NOT granted AND pid <> ${pidPrimero}`;
    if (esperando > 0) break;
    if (terminado || Date.now() > tope) {
      throw new Error(`el segundo registrar nunca quedó esperando el advisory lock (${terminado ? "terminó sin esperar" : "tope de 5 s"})`);
    }
    await Bun.sleep(20);
  }
  await primero`COMMIT`;
  primero.release();
  expect(await segundo).toBe(false);
  expect((await sql`SELECT url_boleta FROM cartera.boletas WHERE pago_id = ${vivo}`).map((b) => b.url_boleta)).toEqual(["u1"]);
  expect(await deps.pendientes(25)).toEqual([billed]);
  await sql.end();
});
