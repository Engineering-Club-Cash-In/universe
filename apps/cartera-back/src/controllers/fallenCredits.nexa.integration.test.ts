import { expect, spyOn, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Postgres real: nexa_payment_events.pago_id referencia pagos_credito sin ON DELETE, así que
// borrar pagos Nexa sin desvincular antes el evento revienta. Un mock no lo detecta.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

const migracion = (archivo: string) => Bun.file(new URL(`../../drizzle/${archivo}`, import.meta.url)).text();

const setup = async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, credito_id integer, numero_cuota integer)`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer, cuota_id integer,
    monto_boleta numeric(18,2))`;
  // Las migraciones reales: nexa_payment_events (con la FK de pago_id sin ON DELETE) y pago_id_eliminado.
  await sql`CREATE TABLE cartera.boletas (id serial PRIMARY KEY,
    pago_id integer NOT NULL REFERENCES cartera.pagos_credito (pago_id), url_boleta varchar(255) NOT NULL)`;
  await sql.unsafe(await migracion("0039_add_nexa_internal_payments.sql")).simple();
  await sql.unsafe(await migracion("0050_nexa_evento_pago_eliminado.sql")).simple();
  await sql.unsafe(await migracion("0050_nexa_evento_pago_eliminado.sql")).simple();
  const { db } = await import("../database");
  const { borrarPagosDelCredito, eventosNexaFacturando } = await import("./fallenCredits");
  return { sql, db, borrarPagosDelCredito, eventosNexaFacturando };
};

let referencia = 0;
const insertarEvento = async (sql: postgres.Sql, credito: number, pago: number, status: string) => {
  referencia += 1;
  const [e] = await sql`INSERT INTO cartera.nexa_payment_events
      (external_reference, nonce, credito_id, amount, currency, payload_hash, pago_id, status, updated_at)
    VALUES (${`ref-${referencia}`}, ${`nonce-${referencia}`}, ${credito}, 100.00, 'GTQ', ${"a".repeat(64)},
      ${pago}, ${status}, '2020-01-01')
    RETURNING id`;
  await sql`UPDATE cartera.pagos_credito SET nexa_payment_event_id = ${e!.id} WHERE pago_id = ${pago}`;
  return { id: e!.id as number, externalReference: `ref-${referencia}` };
};

integrationTest("borrarPagosDelCredito: desvincula los eventos Nexa, borra los pagos y respeta la cuota 0", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  await sql`INSERT INTO cartera.creditos VALUES (1), (2)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (10, 1, 0), (11, 1, 1), (12, 1, 2), (20, 2, 1)`;
  const pagos = (cuota: number, credito = 1) => sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta)
    VALUES (${credito}, ${cuota}, 100) RETURNING pago_id`;
  const [p0] = await pagos(10);
  const [p1] = await pagos(11);
  const [p2] = await pagos(12);
  const [otro] = await pagos(20, 2);
  const evento = async (credito: number, pago: number, status: string) =>
    (await insertarEvento(sql, credito, pago, status)).id;
  const e1 = await evento(1, p1!.pago_id, "applied");
  const e2 = await evento(1, p2!.pago_id, "applied");
  const eCuota0 = await evento(1, p0!.pago_id, "applied");
  const eOtro = await evento(2, otro!.pago_id, "applied");

  const desvinculados = await db.transaction((tx) => borrarPagosDelCredito(tx, 1, 10));

  expect(desvinculados).toBe(2);
  const restantes = await sql`SELECT pago_id FROM cartera.pagos_credito ORDER BY pago_id`;
  expect(restantes.map((r) => r.pago_id)).toEqual([p0!.pago_id, otro!.pago_id]);
  const eventos = await sql`SELECT id, status, pago_id, pago_id_eliminado, updated_at > '2021-01-01' AS tocado
    FROM cartera.nexa_payment_events ORDER BY id`;
  const porId = new Map(eventos.map((e) => [e.id, e]));
  expect(porId.get(e1)).toMatchObject({ status: "applied", pago_id: null, pago_id_eliminado: p1!.pago_id, tocado: true });
  expect(porId.get(e2)).toMatchObject({ status: "applied", pago_id: null, pago_id_eliminado: p2!.pago_id, tocado: true });
  expect(porId.get(eCuota0)).toMatchObject({ pago_id: p0!.pago_id, pago_id_eliminado: null, tocado: false });
  expect(porId.get(eOtro)).toMatchObject({ pago_id: otro!.pago_id, pago_id_eliminado: null, tocado: false });

  // Sin cuota 0: se borran todos los pagos del crédito y el evento restante también se desvincula.
  expect(await db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined))).toBe(1);
  expect((await sql`SELECT pago_id FROM cartera.pagos_credito WHERE credito_id = 1`).length).toBe(0);
  await sql.end();
});

integrationTest("borrarPagosDelCredito: borra la boleta-imagen del pago Nexa antes que el pago (la FK no tiene ON DELETE)", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  const [nexa] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta)
    VALUES (1, 11, 100) RETURNING pago_id`;
  await insertarEvento(sql, 1, nexa!.pago_id, "applied");
  await sql`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${nexa!.pago_id}, 'https://r2/boletas-nexa/x.png')`;

  await db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined));

  expect((await sql`SELECT pago_id FROM cartera.pagos_credito`).length).toBe(0);
  expect((await sql`SELECT id FROM cartera.boletas`).length).toBe(0);

  // La boleta de un pago manual no se toca: el DELETE sigue fallando por la FK, como antes.
  const [manual] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta)
    VALUES (1, 11, 100) RETURNING pago_id`;
  await sql`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${manual!.pago_id}, 'manual.png')`;
  await expect(db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined))).rejects.toThrow();
  expect((await sql`SELECT pago_id FROM cartera.boletas`).map((b) => b.pago_id)).toEqual([manual!.pago_id]);
  await sql.end();
});

integrationTest("borrarPagosDelCredito: una boleta-imagen que se registra en paralelo no tumba el borrado", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  const [nexa] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta)
    VALUES (1, 11, 100) RETURNING pago_id`;
  await insertarEvento(sql, 1, nexa!.pago_id, "billing_pending");

  // El registro (otra conexión) ya insertó la boleta pero todavía no commitea.
  const registro = await sql.reserve();
  await registro`BEGIN`;
  await registro`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${nexa!.pago_id}, 'https://r2/boletas-nexa/x.png')`;
  const borrado = db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined));
  await new Promise((r) => setTimeout(r, 300));
  await registro`COMMIT`;
  registro.release();

  // Sin el FOR UPDATE el DELETE de boletas no la veía y el de pagos reventaba con 23503.
  await borrado;
  expect((await sql`SELECT pago_id FROM cartera.pagos_credito`).length).toBe(0);
  expect((await sql`SELECT id FROM cartera.boletas`).length).toBe(0);
  await sql.end();
});

integrationTest("después de marcar CAÍDO, el reintento de Nexa de la misma transferencia sigue siendo idempotente", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  const [pago] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta) VALUES (1, 11, 100) RETURNING pago_id`;
  const evento = await insertarEvento(sql, 1, pago!.pago_id, "applied");

  await db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined));

  const client = { query: async (text: string, values?: unknown[]) => ({ rows: await sql.unsafe(text, values as never[]) }) };
  const claim = await claimNexaPaymentEvent(
    client,
    { externalReference: evento.externalReference, creditoId: 1, amount: "100.00", currency: "GTQ" } as never,
    { nonce: "nonce-reintento", payloadHash: "a".repeat(64), now: new Date() },
  );
  expect(claim).toEqual({ kind: "applied", paymentId: pago!.pago_id, eventId: evento.id });
  const [despues] = await sql`SELECT status, pago_id, pago_id_eliminado FROM cartera.nexa_payment_events WHERE id = ${evento.id}`;
  expect(despues).toMatchObject({ status: "applied", pago_id: null, pago_id_eliminado: pago!.pago_id });
  await sql.end();
});

integrationTest("eventosNexaFacturando: detecta la facturación en curso o sin confirmar y bloquea esas filas hasta el commit", async () => {
  const { sql, db, eventosNexaFacturando } = await setup();
  await sql`INSERT INTO cartera.creditos VALUES (1), (2)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1), (21, 2, 1)`;
  const pago = async (credito: number, cuota: number) => (await sql`INSERT INTO cartera.pagos_credito
    (credito_id, cuota_id, monto_boleta) VALUES (${credito}, ${cuota}, 100) RETURNING pago_id`)[0]!.pago_id as number;
  const ev: Record<string, number> = {};
  for (const status of ["billing_pending", "billing_running", "billing_unknown", "applied", "billed", "billing_failed"]) {
    ev[status] = (await insertarEvento(sql, 1, await pago(1, 11), status)).id;
  }
  // Otro crédito con facturación en curso: no cuenta.
  await insertarEvento(sql, 2, await pago(2, 21), "billing_running");

  let liberar!: () => void;
  const abierta = new Promise<void>((r) => { liberar = r; });
  let entro!: (filas: Array<{ id: number; status: string }>) => void;
  const leidas = new Promise<Array<{ id: number; status: string }>>((r) => { entro = r; });
  const tx = db.transaction(async (t) => {
    entro(await eventosNexaFacturando(t, 1));
    await abierta;
  });

  const filas = await leidas;
  // billing_pending no se devuelve (no bloquea CAIDO) pero sí queda bloqueado: ver la prueba de abajo.
  expect(filas.map((f) => f.status).sort()).toEqual(["billing_running", "billing_unknown"]);
  expect(filas.map((f) => f.id).sort((a, b) => a - b))
    .toEqual([ev.billing_running!, ev.billing_unknown!]);

  // Una fila bloqueada: el UPDATE de otra conexión (lo que haría completeNexaBilling) espera.
  const bloqueado = sql`UPDATE cartera.nexa_payment_events SET status = 'billed' WHERE id = ${ev.billing_running!}`
    .then(() => "hecho");
  // Una fila no bloqueada (applied) se actualiza sin esperar.
  const libre = sql`UPDATE cartera.nexa_payment_events SET error = 'x' WHERE id = ${ev.applied!}`.then(() => "hecho");
  const espera = (ms: number) => Bun.sleep(ms).then(() => "esperando");
  expect(await Promise.race([libre, espera(2000)])).toBe("hecho");
  expect(await Promise.race([bloqueado, espera(400)])).toBe("esperando");

  liberar();
  await tx;
  expect(await Promise.race([bloqueado, espera(2000)])).toBe("hecho");
  const [despues] = await sql`SELECT status FROM cartera.nexa_payment_events WHERE id = ${ev.billing_running!}`;
  expect(despues!.status).toBe("billed");
  await sql.end();
});

integrationTest("billing_pending (facturación apagada) no frena CAIDO, y el pago borrado ya no se puede facturar", async () => {
  const { sql, db, borrarPagosDelCredito, eventosNexaFacturando } = await setup();
  // nexaPaymentRuntime arrastra el paquete de correo, que exige estas variables al importarse.
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const { startNexaBilling } = await import("./nexaPaymentRuntime");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  const [pago] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta) VALUES (1, 11, 100) RETURNING pago_id`;
  const { id } = await insertarEvento(sql, 1, pago!.pago_id, "billing_pending");

  // La transacción de CAIDO: chequea (nada bloquea), desvincula y borra; queda abierta un momento.
  let liberar!: () => void;
  const abierta = new Promise<void>((r) => { liberar = r; });
  let entro!: (filas: Array<{ id: number; status: string }>) => void;
  const leidas = new Promise<Array<{ id: number; status: string }>>((r) => { entro = r; });
  const tx = db.transaction(async (t) => {
    const filas = await eventosNexaFacturando(t, 1);
    await borrarPagosDelCredito(t, 1, undefined);
    entro(filas);
    await abierta;
  });
  expect(await leidas).toEqual([]);

  // Si en ese momento arranca la facturación (se prendió la bandera), espera el commit del CAIDO
  // y luego ve pago_id NULL: no arranca, y avisa que fue porque el pago se borró.
  const arranque = startNexaBilling(id);
  const espera = (ms: number) => Bun.sleep(ms).then(() => "esperando");
  expect(await Promise.race([arranque.then(() => "hecho"), espera(400)])).toBe("esperando");
  liberar();
  await tx;
  expect(await arranque).toBe("payment_deleted");
  // La facturación diferida completa: queda pending (no billing_unknown) y no llama al proveedor.
  const { runNexaBilling } = await import("./nexaBilling");
  const salida = await runNexaBilling({
    enabled: true,
    eventId: id,
    paymentIds: [pago!.pago_id],
    start: startNexaBilling,
    invoice: async () => { throw new Error("no debe facturar un pago borrado"); },
  });
  expect(salida).toEqual({ kind: "pending", code: "billing_payment_deleted" });
  const [despues] = await sql`SELECT status, pago_id, pago_id_eliminado FROM cartera.nexa_payment_events WHERE id = ${id}`;
  expect(despues).toMatchObject({ status: "billing_pending", pago_id: null, pago_id_eliminado: pago!.pago_id });
  expect((await sql`SELECT 1 FROM cartera.pagos_credito WHERE credito_id = 1`).length).toBe(0);
  await sql.end();
});

integrationTest("billing_failed (reintento de facturación diferido) no frena CAIDO, queda bloqueado, y el start concurrente ve el pago borrado sin llegar al proveedor", async () => {
  const { sql, db, borrarPagosDelCredito, eventosNexaFacturando } = await setup();
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const { startNexaBilling } = await import("./nexaPaymentRuntime");
  const { runNexaBilling } = await import("./nexaBilling");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  const [pago] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta) VALUES (1, 11, 100) RETURNING pago_id`;
  const { id } = await insertarEvento(sql, 1, pago!.pago_id, "billing_failed");

  let liberar!: () => void;
  const abierta = new Promise<void>((r) => { liberar = r; });
  let entro!: (filas: Array<{ id: number; status: string }>) => void;
  const leidas = new Promise<Array<{ id: number; status: string }>>((r) => { entro = r; });
  const tx = db.transaction(async (t) => {
    // El reintento de facturación todavía no arrancó: el chequeo lo bloquea sin rechazar el CAIDO.
    const filas = await eventosNexaFacturando(t, 1);
    entro(filas);
    await abierta;
    await borrarPagosDelCredito(t, 1, undefined);
  });
  expect(await leidas).toEqual([]);

  // El reintento arranca entre el chequeo y el borrado: espera el commit del CAIDO.
  let facturo = false;
  const salida = runNexaBilling({
    enabled: true,
    eventId: id,
    paymentIds: [pago!.pago_id],
    start: startNexaBilling,
    invoice: async () => { facturo = true; throw new Error("no debe facturar un pago borrado"); },
  });
  const espera = (ms: number) => Bun.sleep(ms).then(() => "esperando");
  const antesDelCommit = await Promise.race([salida.then(() => "hecho", () => "hecho"), espera(400)]);
  // Se libera antes de afirmar: si la prueba falla, la transacción no queda colgada.
  liberar();
  await tx;
  expect(facturo).toBe(false);
  expect(antesDelCommit).toBe("esperando");
  expect(await salida).toEqual({ kind: "pending", code: "billing_payment_deleted" });
  expect(await startNexaBilling(id)).toBe("payment_deleted");
  const [despues] = await sql`SELECT status, pago_id, pago_id_eliminado FROM cartera.nexa_payment_events WHERE id = ${id}`;
  expect(despues).toMatchObject({ status: "billing_failed", pago_id: null, pago_id_eliminado: pago!.pago_id });
  expect((await sql`SELECT 1 FROM cartera.pagos_credito WHERE credito_id = 1`).length).toBe(0);
  await sql.end();
});

integrationTest("un evento manual_review sin pago_id pero con filas registradas queda marcado al borrar, y el reintento es aplicado", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (10, 1, 0), (11, 1, 1), (12, 1, 2)`;
  const pago = async (cuota: number) => (await sql`INSERT INTO cartera.pagos_credito
    (credito_id, cuota_id, monto_boleta) VALUES (1, ${cuota}, 100) RETURNING pago_id`)[0]!.pago_id as number;
  const p1 = await pago(11);
  const p2 = await pago(12);
  // El registro escribió las filas y reventó antes de ligar el evento: pago_id NULL.
  const evento = await insertarEvento(sql, 1, p1, "manual_review");
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = NULL WHERE id = ${evento.id}`;
  await sql`UPDATE cartera.pagos_credito SET nexa_payment_event_id = ${evento.id} WHERE pago_id = ${p2}`;
  // Un evento manual_review sin filas no se toca.
  const sinFilas = await insertarEvento(sql, 1, await pago(10), "manual_review");
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = NULL WHERE id = ${sinFilas.id}`;

  expect(await db.transaction((tx) => borrarPagosDelCredito(tx, 1, 10))).toBe(1);

  const [despues] = await sql`SELECT status, pago_id, pago_id_eliminado FROM cartera.nexa_payment_events WHERE id = ${evento.id}`;
  expect(despues).toMatchObject({ status: "manual_review", pago_id: null, pago_id_eliminado: Math.min(p1, p2) });
  const [intacto] = await sql`SELECT pago_id_eliminado FROM cartera.nexa_payment_events WHERE id = ${sinFilas.id}`;
  expect(intacto!.pago_id_eliminado).toBeNull();
  expect((await sql`SELECT 1 FROM cartera.pagos_credito WHERE credito_id = 1 AND cuota_id <> 10`).length).toBe(0);

  const client = { query: async (text: string, values?: unknown[]) => ({ rows: await sql.unsafe(text, values as never[]) }) };
  const claim = await claimNexaPaymentEvent(
    client,
    { externalReference: evento.externalReference, creditoId: 1, amount: "100.00", currency: "GTQ" } as never,
    { nonce: "nonce-reintento-mr", payloadHash: "a".repeat(64), now: new Date() },
  );
  expect(claim).toEqual({ kind: "applied", paymentId: Math.min(p1, p2), eventId: evento.id });
  await sql.end();
});

integrationTest("un evento failed (Nexa devolvió el dinero) nunca recibe la marca al borrar, y el reintento sigue como failed", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1), (12, 1, 2)`;
  const pago = async (cuota: number) => (await sql`INSERT INTO cartera.pagos_credito
    (credito_id, cuota_id, monto_boleta) VALUES (1, ${cuota}, 100) RETURNING pago_id`)[0]!.pago_id as number;
  // Filas que alcanzaron a crearse antes del rechazo, ligadas solo por nexa_payment_event_id.
  const conFilas = await insertarEvento(sql, 1, await pago(11), "failed");
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = NULL WHERE id = ${conFilas.id}`;
  // Defensa: un failed que todavía apunta al pago. Se le suelta el pago_id (FK) sin marcarlo.
  const conPagoId = await insertarEvento(sql, 1, await pago(12), "failed");

  expect(await db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined))).toBe(1);

  const filas = await sql`SELECT id, status, pago_id, pago_id_eliminado FROM cartera.nexa_payment_events
    WHERE id IN (${conFilas.id}, ${conPagoId.id}) ORDER BY id`;
  expect(filas.map((f) => ({ ...f }))).toEqual([
    { id: conFilas.id, status: "failed", pago_id: null, pago_id_eliminado: null },
    { id: conPagoId.id, status: "failed", pago_id: null, pago_id_eliminado: null },
  ]);
  expect((await sql`SELECT 1 FROM cartera.pagos_credito WHERE credito_id = 1`).length).toBe(0);

  const client = { query: async (text: string, values?: unknown[]) => ({ rows: await sql.unsafe(text, values as never[]) }) };
  const claim = await claimNexaPaymentEvent(
    client,
    { externalReference: conFilas.externalReference, creditoId: 1, amount: "100.00", currency: "GTQ" } as never,
    { nonce: "nonce-reintento-failed", payloadHash: "a".repeat(64), now: new Date() },
  );
  expect(claim).toEqual({ kind: "retry", eventId: conFilas.id });
  await sql.end();
});

integrationTest("la guarda de no reversible deja anular las filas de un evento failed y bloquea las de uno aceptado o incierto", async () => {
  const { sql, db } = await setup();
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const { rechazarSiPagoEsNexa, pagoNexaBloqueaAnular, NexaPaymentNotReversibleError } = await import("./nexaPagoNoReversible");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  const pago = async () => (await sql`INSERT INTO cartera.pagos_credito
    (credito_id, cuota_id, monto_boleta) VALUES (1, 11, 100) RETURNING pago_id`)[0]!.pago_id as number;
  const manual = await pago();
  const porStatus: Record<string, number> = {};
  for (const status of ["failed", "applied", "processing", "manual_review", "billing_pending", "billing_unknown", "billed"]) {
    const p = await pago();
    await insertarEvento(sql, 1, p, status);
    porStatus[status] = p;
  }

  await expect(rechazarSiPagoEsNexa({ credito_id: 1, pago_id: manual }, db)).resolves.toBeUndefined();
  await expect(rechazarSiPagoEsNexa({ credito_id: 1, pago_id: porStatus.failed! }, db)).resolves.toBeUndefined();
  for (const status of ["applied", "processing", "manual_review", "billing_pending", "billing_unknown", "billed"]) {
    const error = await rechazarSiPagoEsNexa({ credito_id: 1, pago_id: porStatus[status]! }, db).catch((e) => e);
    expect(error).toBeInstanceOf(NexaPaymentNotReversibleError);
  }
  // El chequeo que decide (bajo el candado, dentro de la tx) lee lo mismo.
  const [evFailed] = await sql`SELECT nexa_payment_event_id AS id FROM cartera.pagos_credito WHERE pago_id = ${porStatus.failed!}`;
  const [evApplied] = await sql`SELECT nexa_payment_event_id AS id FROM cartera.pagos_credito WHERE pago_id = ${porStatus.applied!}`;
  expect(await db.transaction((tx) => pagoNexaBloqueaAnular(tx, evFailed!.id))).toBe(false);
  expect(await db.transaction((tx) => pagoNexaBloqueaAnular(tx, evApplied!.id))).toBe(true);
  await sql.end();
});

// El comprobante PNG se borra de R2 recién después del commit, y solo en producción. R2 es un spy.
const urlR2 = "https://r2/boletas-nexa/0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b.png";
const conR2Falso = async <T>(trabajo: (borradas: unknown[]) => Promise<T>) => {
  const config = (await import("../config")).default;
  const { s3 } = await import("../utils/functions/uploadsFiles");
  const borradas: unknown[] = [];
  const send = spyOn(s3, "send").mockImplementation((async (c: { input: { Key: string } }) => {
    borradas.push(c.input.Key);
  }) as never);
  const antes = config.environment;
  config.environment = "production";
  try {
    return await trabajo(borradas);
  } finally {
    config.environment = antes;
    send.mockRestore();
  }
};
const pagoNexaConBoleta = async (sql: postgres.Sql, cuota: number) => {
  const [p] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_boleta) VALUES (1, ${cuota}, 100) RETURNING pago_id`;
  await insertarEvento(sql, 1, p!.pago_id, "applied");
  // Desvinculado: si el evento apunta al pago, credits y migratePayments siguen frenados por esa FK.
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = NULL`;
  await sql`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${p!.pago_id}, ${urlR2})`;
};

integrationTest("borrarPagosDelCredito devuelve la URL del comprobante; R2 lo borra tras el commit y nunca tras un rollback", async () => {
  const { sql, db, borrarPagosDelCredito } = await setup();
  const { borrandoComprobantesNexaTrasCommit } = await import("./nexaBoletaR2");
  await sql`INSERT INTO cartera.creditos VALUES (1)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1, 1)`;
  await pagoNexaConBoleta(sql, 11);
  await conR2Falso(async (borradas) => {
    await expect(borrandoComprobantesNexaTrasCommit((urls) => db.transaction(async (tx) => {
      await borrarPagosDelCredito(tx, 1, undefined, urls);
      expect(urls).toEqual([urlR2]);
      throw new Error("rollback");
    }))).rejects.toThrow("rollback");
    await Bun.sleep(20);
    expect(borradas).toEqual([]);
    expect((await sql`SELECT url_boleta FROM cartera.boletas`).length).toBe(1);

    await borrandoComprobantesNexaTrasCommit((urls) => db.transaction((tx) => borrarPagosDelCredito(tx, 1, undefined, urls)));
    await Bun.sleep(20);
    expect(borradas).toEqual([urlR2.slice(urlR2.indexOf("boletas-nexa/"))]);
  });
  await sql.end();
});

integrationTest("reducir el plazo (credits) y ajustar con SIFCO (migratePayments) borran de R2 el comprobante del pago Nexa", async () => {
  const { sql } = await setup();
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const { syncScheduleOnTermsChange } = await import("./credits");
  const { ajustarCuotasConSIFCO } = await import("./migratePayments");
  await sql`ALTER TABLE cartera.creditos ADD plazo integer, ADD cuota numeric, ADD cuota_interes numeric,
    ADD numero_credito_sifco varchar(40)`;
  await sql`ALTER TABLE cartera.cuotas_credito ADD fecha_vencimiento date, ADD pagado boolean DEFAULT false,
    ADD liquidado_inversionistas boolean DEFAULT false, ADD fecha_liquidacion_inversionistas timestamp, ADD createdat timestamp`;
  await sql`ALTER TABLE cartera.pagos_credito ADD fecha_vencimiento date`;
  await sql`INSERT INTO cartera.creditos VALUES (1, 3, 100, 10, '0101')`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento)
    VALUES (11, 1, 1, '2026-01-30'), (12, 1, 2, '2026-02-28'), (13, 1, 3, '2026-03-30')`;
  await pagoNexaConBoleta(sql, 13);
  await pagoNexaConBoleta(sql, 12);
  const key = urlR2.slice(urlR2.indexOf("boletas-nexa/"));

  await conR2Falso(async (borradas) => {
    await syncScheduleOnTermsChange({ creditoId: 1, newCuota: 100, newPlazo: 2, preloadCredit: { cuota: 100, plazo: 3 } as never });
    await Bun.sleep(20);
    expect(borradas).toEqual([key]);
    await ajustarCuotasConSIFCO({ numero_credito_sifco: "0101", cuota_esperada: 1, fecha_cuota: "2026-01-30", plazo_completo: 1 });
    await Bun.sleep(20);
    expect(borradas).toEqual([key, key]);
  });
  expect((await sql`SELECT id FROM cartera.boletas`).length).toBe(0);
  await sql.end();
});
