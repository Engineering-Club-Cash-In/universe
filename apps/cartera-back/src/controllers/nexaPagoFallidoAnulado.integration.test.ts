import { expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import type { NexaPaymentDependencies } from "./nexaPayments";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Postgres real: un evento Nexa `failed` (Nexa rechazó la transferencia y devolvió el dinero) con
// una fila de pago que alcanzó a crearse. Al anularla, la fila se desliga del evento; si quedara
// ligada, el reintento de Nexa la encontraría con `findPayments` (que no filtra anuladas) y la
// reaplicaría en vez de registrar un pago limpio.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const migracion = (archivo: string) => Bun.file(new URL(`../../drizzle/${archivo}`, import.meta.url)).text();
const HASH = "a".repeat(64);
const paymentLock = {} as PaymentAdvisoryLock;

const setup = async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  // nexaPaymentRuntime arrastra el paquete de correo, que exige estas variables al importarse.
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TYPE cartera.mora_evento_origen AS ENUM
    ('PROCESO_AUTO','API_MANUAL','CONDONACION_INDIVIDUAL','CONDONACION_MASIVA')`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY,
    numero_credito_sifco text, estado_devolucion text)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, credito_id integer)`;
  await sql`CREATE TABLE cartera.moras_historial (historial_id serial PRIMARY KEY,
    credito_id integer NOT NULL, mora_id integer, tipo_evento text NOT NULL,
    origen cartera.mora_evento_origen NOT NULL,
    monto_anterior numeric(18,2) NOT NULL DEFAULT 0, monto_nuevo numeric(18,2) NOT NULL DEFAULT 0,
    cuotas_atrasadas_anterior integer NOT NULL DEFAULT 0, cuotas_atrasadas_nuevas integer NOT NULL DEFAULT 0,
    capital_credito numeric(18,2), porcentaje_mora numeric(5,4), usuario_id integer, motivo text,
    pago_id integer, fecha timestamp NOT NULL DEFAULT now())`;
  // Las columnas que leen findPayments del runtime y anularPagoYRestituirMora.
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer, cuota_id integer, validation_status text,
    monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    pagado boolean, createdat timestamp DEFAULT now(),
    "paymentFalse" boolean NOT NULL DEFAULT false)`;
  await sql.unsafe(await migracion("0039_add_nexa_internal_payments.sql")).simple();
  await sql.unsafe(await migracion("0043_mora_pagada_cuota.sql")).simple();
  await sql.unsafe(await migracion("0050_nexa_evento_pago_eliminado.sql")).simple();
  // Lo que toca la salida temprana de falsePayment (fila ya anulada).
  await sql`CREATE TABLE cartera.ajuste_fecha_ideal_pago (id serial PRIMARY KEY, credito_id integer,
    fecha_cobro timestamp, pago_id integer)`;
  await sql`CREATE TABLE cartera.pagos_credito_inversionistas_espejo (id serial PRIMARY KEY, pago_id integer)`;
  await sql`INSERT INTO cartera.creditos VALUES (1, 'S-1', NULL)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (11, 1)`;
  return { sql };
};

let referencia = 0;
/** Evento `failed` con una fila de pago validada ligada solo por nexa_payment_event_id. */
const eventoFallidoConFila = async (sql: postgres.Sql, status = "failed") => {
  referencia += 1;
  const externalReference = `ref-fallido-${referencia}`;
  const [e] = await sql`INSERT INTO cartera.nexa_payment_events
      (external_reference, nonce, credito_id, amount, currency, payload_hash, status)
    VALUES (${externalReference}, ${`nonce-${referencia}`}, 1, 10.00, 'GTQ', ${HASH}, ${status})
    RETURNING id`;
  const [p] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, mora, pagado, nexa_payment_event_id)
    VALUES (1, 11, 'validated', 10.00, 10.00, 0, true, ${e!.id})
    RETURNING pago_id`;
  return { eventId: e!.id as number, pagoId: p!.pago_id as number, externalReference };
};

/** El reintento de Nexa: claim real + processNexaPayment con el findPayments real del runtime. */
const reintentar = async (sql: postgres.Sql, externalReference: string, nonce: string) => {
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  const { processNexaPayment } = await import("./nexaPayments");
  const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
  const client = { query: async (text: string, values?: unknown[]) => ({ rows: await sql.unsafe(text, values as never[]) }) };
  const registrados: number[] = [];
  const aplicados: number[] = [];
  const completados: Array<[number, number]> = [];
  const result = await processNexaPayment(
    { externalReference, creditoId: 1, amount: "10.00", currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z", token: "1111222233334444" },
    { nonce, payloadHash: HASH, now: new Date() },
    {
      withCreditLock: async (_creditoId, work) => work(paymentLock),
      claim: (body, context) => claimNexaPaymentEvent(client, body as never, context),
      loadCredit: async () => ({
        usuarioId: 5,
        statusCredit: "ACTIVO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      findPayments: nexaPaymentDependencies.findPayments,
      registerPayment: async (_body, eventId) => {
        const [p] = await sql`INSERT INTO cartera.pagos_credito
            (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, mora, pagado, nexa_payment_event_id)
          VALUES (1, 11, 'pending', 10.00, 10.00, 0, false, ${eventId})
          RETURNING pago_id`;
        registrados.push(p!.pago_id as number);
        return { success: true };
      },
      applyPayment: async (paymentId) => { aplicados.push(paymentId); return { success: true }; },
      complete: async (eventId, paymentId) => { completados.push([eventId, paymentId]); },
      fail: async () => undefined,
      billPayments: async () => ({ kind: "pending" as const, code: "billing_not_enabled" }),
      completeBilling: async () => undefined,
      failBilling: async () => undefined,
    } satisfies NexaPaymentDependencies,
  );
  return { result, registrados, aplicados, completados };
};

integrationTest("anular por falsePayment (anularPagoYRestituirMora) desliga la fila de un evento failed y el reintento registra un pago nuevo", async () => {
  const { sql } = await setup();
  const { db } = await import("../database");
  const { anularPagoYRestituirMora } = await import("./anularPagoMora");
  const { eventId, pagoId, externalReference } = await eventoFallidoConFila(sql);

  await db.transaction((tx) => anularPagoYRestituirMora(tx as never, { pago_id: pagoId, credito_id: 1 }, {
    updateMora: (async () => ({ success: true })) as never,
    resetAjusteFechaIdeal: (async () => undefined) as never,
    revertirRubros: (async () => []) as never,
  }));

  const [fila] = await sql`SELECT "paymentFalse", nexa_payment_event_id FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
  expect(fila).toMatchObject({ paymentFalse: true, nexa_payment_event_id: null });

  const { result, registrados, aplicados, completados } = await reintentar(sql, externalReference, "nonce-reintento-a");
  expect(registrados).toHaveLength(1);
  expect(registrados[0]).not.toBe(pagoId);
  expect(aplicados).toEqual(registrados);
  expect(completados).toEqual([[eventId, registrados[0]!]]);
  expect(result).toMatchObject({ paymentId: registrados[0], paymentIds: registrados, idempotent: false });
  await sql.end();
});

integrationTest("anular por reversePayment (desliga y borra la fila, rama con hermanas) también deja que el reintento registre limpio", async () => {
  const { sql } = await setup();
  const { db } = await import("../database");
  const { desligarFilaDeEventoNexaFallido, pagoNexaBloqueaAnular } = await import("./nexaPagoNoReversible");
  const { eventId, pagoId, externalReference } = await eventoFallidoConFila(sql);

  // Lo que hace reversePayment dentro de su transacción: guarda, desliga y luego resetea o borra.
  await db.transaction(async (tx) => {
    expect(await pagoNexaBloqueaAnular(tx, eventId)).toBe(false);
    expect(await desligarFilaDeEventoNexaFallido(tx, pagoId, eventId)).toBe(true);
    await tx.execute(dsql`DELETE FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`);
  });
  expect((await sql`SELECT 1 FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`).length).toBe(0);

  const { registrados, aplicados } = await reintentar(sql, externalReference, "nonce-reintento-b");
  expect(registrados).toHaveLength(1);
  expect(aplicados).toEqual(registrados);
  await sql.end();
});

integrationTest("un evento failed que todavía apunta a la fila (pago_id): el desligue le suelta el pago_id, el DELETE de la reversa no viola la FK y el reintento registra limpio", async () => {
  const { sql } = await setup();
  const { db } = await import("../database");
  const { desligarFilaDeEventoNexaFallido, pagoNexaBloqueaAnular } = await import("./nexaPagoNoReversible");
  const { eventId, pagoId, externalReference } = await eventoFallidoConFila(sql);
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = ${pagoId} WHERE id = ${eventId}`;

  // La secuencia de reversePayment con la rama de pago parcial que borra la fila.
  await db.transaction(async (tx) => {
    expect(await pagoNexaBloqueaAnular(tx, eventId)).toBe(false);
    expect(await desligarFilaDeEventoNexaFallido(tx, pagoId, eventId)).toBe(true);
    await tx.execute(dsql`DELETE FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`);
  });
  expect((await sql`SELECT 1 FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`).length).toBe(0);
  // Sin la marca de "aceptado y borrado": sigue siendo un failed que se reintenta.
  const [evento] = await sql`SELECT status, pago_id, pago_id_eliminado FROM cartera.nexa_payment_events WHERE id = ${eventId}`;
  expect(evento).toMatchObject({ status: "failed", pago_id: null, pago_id_eliminado: null });

  const { result, registrados, aplicados, completados } = await reintentar(sql, externalReference, "nonce-reintento-f");
  expect(registrados).toHaveLength(1);
  expect(registrados[0]).not.toBe(pagoId);
  expect(aplicados).toEqual(registrados);
  expect(completados).toEqual([[eventId, registrados[0]!]]);
  expect(result).toMatchObject({ paymentId: registrados[0], paymentIds: registrados, idempotent: false });
  await sql.end();
});

integrationTest("el desligue no le suelta el pago_id a un evento que no es failed ni a uno que apunta a otra fila", async () => {
  const { sql } = await setup();
  const { db } = await import("../database");
  const { desligarFilaDeEventoNexaFallido } = await import("./nexaPagoNoReversible");
  const aceptado = await eventoFallidoConFila(sql, "applied");
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = ${aceptado.pagoId} WHERE id = ${aceptado.eventId}`;
  expect(await db.transaction((tx) => desligarFilaDeEventoNexaFallido(tx, aceptado.pagoId, aceptado.eventId))).toBe(false);
  const otro = await eventoFallidoConFila(sql);
  const [hermana] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, monto_aplicado, nexa_payment_event_id)
    VALUES (1, 11, 0, ${otro.eventId}) RETURNING pago_id`;
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = ${hermana!.pago_id} WHERE id = ${otro.eventId}`;
  expect(await db.transaction((tx) => desligarFilaDeEventoNexaFallido(tx, otro.pagoId, otro.eventId))).toBe(true);

  const eventos = await sql`SELECT id, pago_id FROM cartera.nexa_payment_events WHERE id IN (${aceptado.eventId}, ${otro.eventId}) ORDER BY id`;
  expect(eventos.map((e) => ({ ...e }))).toEqual([
    { id: aceptado.eventId, pago_id: aceptado.pagoId },
    { id: otro.eventId, pago_id: hermana!.pago_id },
  ]);
  await sql.end();
});

integrationTest("fila vieja de un evento failed, anulada y todavía ligada, sin volver a anularla: el reintento la ignora y registra limpio", async () => {
  const { sql } = await setup();
  const { eventId, pagoId, externalReference } = await eventoFallidoConFila(sql);
  // Anulada por un camino viejo: paymentFalse, sigue validated y ligada al evento.
  await sql`UPDATE cartera.pagos_credito SET "paymentFalse" = true, pagado = false WHERE pago_id = ${pagoId}`;

  const { result, registrados, aplicados, completados } = await reintentar(sql, externalReference, "nonce-reintento-c");
  expect(registrados).toHaveLength(1);
  expect(registrados[0]).not.toBe(pagoId);
  expect(aplicados).toEqual(registrados);
  expect(completados).toEqual([[eventId, registrados[0]!]]);
  expect(result).toMatchObject({ paymentIds: registrados });
  // La fila vieja no se toca: sigue anulada y ligada como constancia.
  const [vieja] = await sql`SELECT "paymentFalse", nexa_payment_event_id FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
  expect(vieja).toMatchObject({ paymentFalse: true, nexa_payment_event_id: eventId });
  await sql.end();
});

integrationTest("un evento applied con una fila anulada por un camino viejo sigue contestándose como aplicado, sin re-registrar", async () => {
  const { sql } = await setup();
  const { eventId, pagoId, externalReference } = await eventoFallidoConFila(sql, "applied");
  await sql`UPDATE cartera.nexa_payment_events SET pago_id = ${pagoId} WHERE id = ${eventId}`;
  await sql`UPDATE cartera.pagos_credito SET "paymentFalse" = true WHERE pago_id = ${pagoId}`;

  const { result, registrados, aplicados } = await reintentar(sql, externalReference, "nonce-reintento-e");
  expect(registrados).toEqual([]);
  expect(aplicados).toEqual([]);
  expect(result).toMatchObject({ paymentId: pagoId, paymentIds: [pagoId], idempotent: true });
  await sql.end();
});

integrationTest("el desligue solo toca filas de un evento failed", async () => {
  const { sql } = await setup();
  const { db } = await import("../database");
  const { desligarFilaDeEventoNexaFallido } = await import("./nexaPagoNoReversible");
  for (const status of ["applied", "processing", "manual_review", "billing_pending", "billed"]) {
    const { eventId, pagoId } = await eventoFallidoConFila(sql, status);
    expect(await db.transaction((tx) => desligarFilaDeEventoNexaFallido(tx, pagoId, eventId))).toBe(false);
    const [fila] = await sql`SELECT nexa_payment_event_id FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
    expect(fila!.nexa_payment_event_id).toBe(eventId);
  }
  expect(await db.transaction((tx) => desligarFilaDeEventoNexaFallido(tx, 999, null))).toBe(false);
  await sql.end();
});

integrationTest("una fila de un evento failed que ya estaba anulada y ligada: falsePayment otra vez la desliga y el reintento registra limpio", async () => {
  const { sql } = await setup();
  process.env.DATABASE_URL ??= testDatabaseUrl;
  const { falsePayment } = await import("./payments");
  const { eventId, pagoId, externalReference } = await eventoFallidoConFila(sql);
  // Anulada antes de que la anulación desligara: paymentFalse, sigue validated y ligada.
  await sql`UPDATE cartera.pagos_credito SET "paymentFalse" = true, pagado = false WHERE pago_id = ${pagoId}`;
  // Con su espejo ya escrito, la salida temprana no vuelve a generarlo.
  await sql`INSERT INTO cartera.pagos_credito_inversionistas_espejo (pago_id) VALUES (${pagoId})`;

  const respuesta = await falsePayment(pagoId, 1);
  expect(respuesta).toMatchObject({ message: "Payment was already marked as false" });

  const [fila] = await sql`SELECT "paymentFalse", validation_status, nexa_payment_event_id
    FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
  expect(fila).toMatchObject({ paymentFalse: true, validation_status: "validated", nexa_payment_event_id: null });

  const { registrados, aplicados, completados } = await reintentar(sql, externalReference, "nonce-reintento-d");
  expect(registrados).toHaveLength(1);
  expect(aplicados).toEqual(registrados);
  expect(completados).toEqual([[eventId, registrados[0]!]]);
  await sql.end();
});

integrationTest("la salida temprana de falsePayment no desliga la fila anulada de un evento que no es failed", async () => {
  const { sql } = await setup();
  process.env.DATABASE_URL ??= testDatabaseUrl;
  const { falsePayment } = await import("./payments");
  const { NexaPaymentNotReversibleError } = await import("./nexaPagoNoReversible");
  const { eventId, pagoId } = await eventoFallidoConFila(sql, "applied");
  await sql`UPDATE cartera.pagos_credito SET "paymentFalse" = true WHERE pago_id = ${pagoId}`;

  const error = await falsePayment(pagoId, 1).catch((e) => e);
  expect(error).toBeInstanceOf(NexaPaymentNotReversibleError);
  const [fila] = await sql`SELECT nexa_payment_event_id FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
  expect(fila!.nexa_payment_event_id).toBe(eventId);
  await sql.end();
});
