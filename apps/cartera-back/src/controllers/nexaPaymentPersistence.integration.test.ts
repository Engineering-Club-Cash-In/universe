/// <reference lib="es2022.array" />
// The cross-service test below imports Nexa, whose TypeScript target is ES2022.
import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import Big from "big.js";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const expectRejected = async (promise: PromiseLike<unknown>, message?: string) => {
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    rejected = true;
    if (message) {
      expect(error instanceof Error ? error.message : String(error)).toContain(message);
    }
  }
  expect(rejected).toBe(true);
};

integrationTest("constraints Nexa resisten concurrencia, replay y rollback", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.EMAIL_DOMAIN = "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  const migration = await Bun.file(
    new URL("../../drizzle/0039_add_nexa_internal_payments.sql", import.meta.url),
  ).text();

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;
    await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY)`;
    await sql`CREATE TABLE cartera.pagos_credito (pago_id integer PRIMARY KEY)`;
    await sql`INSERT INTO cartera.creditos VALUES (10)`;
    await sql.unsafe(migration).simple();
    await sql.unsafe(migration).simple();

    await sql`INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ('nonce-persisted')`;
    await expectRejected(
      sql`INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ('nonce-persisted')`,
    );

    const insert = (reference: string, nonce: string) => sql`
      INSERT INTO cartera.nexa_payment_events
        (external_reference, nonce, credito_id, amount, currency, payload_hash)
      VALUES (${reference}, ${nonce}, 10, 10.00, 'GTQ', ${"a".repeat(64)})
    `;
    const concurrent = await Promise.allSettled([
      insert("qa-concurrent", "nonce-concurrent-1"),
      insert("qa-concurrent", "nonce-concurrent-2"),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expectRejected(insert("qa-replay", "nonce-concurrent-1"));

    await expectRejected(sql.begin(async (transaction) => {
      await transaction.unsafe(`
        INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ('nonce-rollback')
      `);
      await transaction.unsafe(`
        INSERT INTO cartera.nexa_payment_events
          (external_reference, nonce, credito_id, amount, currency, payload_hash)
        VALUES ('qa-rollback', 'nonce-rollback', 10, 10.00, 'GTQ', $1)
      `, ["b".repeat(64)]);
      throw new Error("force rollback");
    }), "force rollback");
    const rolledBack = await sql`
      SELECT id FROM cartera.nexa_payment_events WHERE external_reference = 'qa-rollback'
    `;
    expect(rolledBack).toHaveLength(0);
    const rolledBackNonce = await sql`
      SELECT nonce FROM cartera.nexa_payment_nonces WHERE nonce = 'nonce-rollback'
    `;
    expect(rolledBackNonce).toHaveLength(0);

    const [uncertain] = await sql<{ id: number }[]>`
      INSERT INTO cartera.nexa_payment_events
        (external_reference, nonce, credito_id, amount, currency, payload_hash)
      VALUES ('qa-uncertain', 'nonce-uncertain', 10, 10.00, 'GTQ', ${"c".repeat(64)})
      RETURNING id
    `;
    const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
    await nexaPaymentDependencies.fail(uncertain!.id, "payment_outcome_uncertain");
    const [manual] = await sql<{ status: string; error: string }[]>`
      SELECT status, error FROM cartera.nexa_payment_events WHERE id = ${uncertain!.id}
    `;
    expect(manual).toEqual({ status: "manual_review", error: "payment_outcome_uncertain" });

    await sql`INSERT INTO cartera.pagos_credito (pago_id) VALUES (17)`;
    const [billingEvent] = await sql<{ id: number }[]>`
      INSERT INTO cartera.nexa_payment_events
        (external_reference, nonce, credito_id, amount, currency, payload_hash)
      VALUES ('qa-billing-state', 'nonce-billing-state', 10, 10.00, 'GTQ', ${"d".repeat(64)})
      RETURNING id
    `;
    await nexaPaymentDependencies.complete(billingEvent!.id, 17);
    const [pendingBilling] = await sql<{ status: string; pago_id: number }[]>`
      SELECT status, pago_id FROM cartera.nexa_payment_events WHERE id = ${billingEvent!.id}
    `;
    expect(pendingBilling).toEqual({ status: "billing_pending", pago_id: 17 });

    const runtime = await import("./nexaPaymentRuntime");
    const starts = await Promise.all([
      runtime.startNexaBilling(billingEvent!.id),
      runtime.startNexaBilling(billingEvent!.id),
    ]);
    expect(starts.sort()).toEqual([false, true]);
    await runtime.completeNexaBilling(billingEvent!.id, 17);
    await expectRejected(
      runtime.completeNexaBilling(billingEvent!.id, 17),
      "nexa billing completion fence failed",
    );
    const [billed] = await sql<{ status: string; pago_id: number }[]>`
      SELECT status, pago_id FROM cartera.nexa_payment_events WHERE id = ${billingEvent!.id}
    `;
    expect(billed).toEqual({ status: "billed", pago_id: 17 });

    const [unknownEvent] = await sql<{ id: number }[]>`
      INSERT INTO cartera.nexa_payment_events
        (external_reference, nonce, credito_id, amount, currency, payload_hash, status, pago_id)
      VALUES ('qa-billing-unknown', 'nonce-billing-unknown', 10, 10.00, 'GTQ', ${"e".repeat(64)}, 'billing_running', 17)
      RETURNING id
    `;
    await runtime.failNexaBilling(
      unknownEvent!.id,
      "billing_unknown",
      "provider_response_ambiguous",
    );
    const [unknownBilling] = await sql<{ status: string; error: string }[]>`
      SELECT status, error FROM cartera.nexa_payment_events WHERE id = ${unknownEvent!.id}
    `;
    expect(unknownBilling).toEqual({
      status: "billing_unknown",
      error: "provider_response_ambiguous",
    });
  } finally {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);

integrationTest("un evento legado en crash-window acepta el cliente nuevo y queda en revisión sin duplicar efectos", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  const migration = await Bun.file(
    new URL("../../drizzle/0039_add_nexa_internal_payments.sql", import.meta.url),
  ).text();
  const body = {
    externalReference: "qa-crash-before-linked-row",
    creditoId: 10,
    amount: "10.00",
    currency: "GTQ" as const,
    tokenDate: "2026-09-08T23:30:00-06:00",
  };
  const { tokenDate: _legacyOmittedDate, ...legacyBody } = body;
  const legacyPayloadHash = createHash("sha256").update(JSON.stringify(legacyBody)).digest("hex");
  const newPayloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const eventFingerprint = "e".repeat(64);

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;
    await sql`CREATE TABLE cartera.creditos (
      credito_id integer PRIMARY KEY,
      financial_mutations integer NOT NULL DEFAULT 0
    )`;
    await sql`CREATE TABLE cartera.pagos_credito (pago_id integer PRIMARY KEY)`;
    await sql`INSERT INTO cartera.creditos (credito_id) VALUES (10)`;
    await sql.unsafe(migration).simple();

    const queryClient = {
      query: async (text: string, values: unknown[] = []) => ({
        rows: await sql.unsafe(text, values as never[]),
      }),
    };
    const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
    const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
    const freshClaim = await claimNexaPaymentEvent(queryClient, legacyBody, {
      nonce: "nonce-before-crash",
      payloadHash: legacyPayloadHash,
      now: new Date(),
    });
    expect(freshClaim).toMatchObject({ kind: "new" });

    await sql`
      UPDATE cartera.nexa_payment_events
      SET status = 'failed', error = 'pre_effect_failure'
      WHERE external_reference = ${body.externalReference}
    `;
    await expect(claimNexaPaymentEvent(queryClient, legacyBody, {
      nonce: "nonce-safe-failed-retry",
      payloadHash: legacyPayloadHash,
      now: new Date(),
    })).resolves.toMatchObject({ kind: "retry" });
    const [rearmed] = await sql<{ status: string }[]>`
      SELECT status FROM cartera.nexa_payment_events
      WHERE external_reference = ${body.externalReference}
    `;
    expect(rearmed?.status).toBe("processing");

    // Simula updateMora ya confirmado y la caída antes de insertar la primera fila vinculada.
    await sql`UPDATE cartera.creditos SET financial_mutations = financial_mutations + 1 WHERE credito_id = 10`;
    let registrationCalls = 0;
    let paymentLookups = 0;
    let failCalls = 0;

    await expect(processNexaPayment(
      body,
      {
        nonce: "nonce-after-crash",
        payloadHash: newPayloadHash,
        eventFingerprint,
        legacyPayloadHash,
        now: new Date(),
      },
      {
        withCreditLock: async (_creditoId, work) => work({} as never),
        claim: (retryBody, context) => claimNexaPaymentEvent(queryClient, retryBody, context),
        loadCredit: async () => ({
          usuarioId: 5,
          statusCredit: "MOROSO",
          binding: { activo: true, expires_at: null, max_payment_amount: null },
        }),
        findPayments: async () => { paymentLookups += 1; return []; },
        registerPayment: async () => {
          registrationCalls += 1;
          await sql`UPDATE cartera.creditos SET financial_mutations = financial_mutations + 1 WHERE credito_id = 10`;
          return { success: true };
        },
        applyPayment: async () => ({ success: true }),
        complete: async () => undefined,
        fail: async () => { failCalls += 1; },
      },
    )).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));

    const [event] = await sql<{ status: string; error: string | null }[]>`
      SELECT status, error
      FROM cartera.nexa_payment_events
      WHERE external_reference = ${body.externalReference}
    `;
    const [credit] = await sql<{ financial_mutations: number }[]>`
      SELECT financial_mutations FROM cartera.creditos WHERE credito_id = 10
    `;
    expect(event).toEqual({ status: "manual_review", error: "payment_outcome_uncertain" });
    expect(credit?.financial_mutations).toBe(1);
    expect({ registrationCalls, paymentLookups, failCalls }).toEqual({
      registrationCalls: 0,
      paymentLookups: 0,
      failCalls: 0,
    });
  } finally {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);

integrationTest("/newPayment reserva NEXA pero el flujo HMAC interno alcanza el escritor", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.EMAIL_DOMAIN = "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false });

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;

    const { paymentRouter } = await import("../routers/payments");
    const app = new Elysia().use(paymentRouter);
    const token = jwt.sign(
      { id: 1, email: "qa@example.test", role: "ADMIN" },
      process.env.JWT_SECRET || "supersecreto",
    );
    const publicBody = {
      credito_id: 10,
      usuario_id: 5,
      monto_boleta: "10.00",
      fecha_pago: "2026-09-08",
      cuotaApagar: 1,
      url_boletas: [],
      fecha_boleta: "2026-09-08",
    };

    for (const registerBy of ["NEXA", "  nexa  ", "NEXA:7", "  nexa:forged  "]) {
      const response = await app.handle(new Request("http://localhost/newPayment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...publicBody, registerBy }),
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        success: false,
        code: "VALIDATION_FAILED",
        errors: { registerBy: expect.any(Array) },
      });
    }

    const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
    const { createNexaPaymentHandler } = await import("./nexaPayments");
    const { withPaymentAdvisoryLock } = await import("../utils/paymentAdvisoryLock");
    const secret = "s".repeat(32);
    const now = 1_800_000_000_000;
    const rawBody = JSON.stringify({
      externalReference: "qa-internal-schema-boundary",
      creditoId: 10,
      amount: "10.00",
      currency: "GTQ",
      tokenDate: "2026-09-08T23:30:00-06:00",
    });
    const timestamp = String(now / 1000);
    const nonce = "nonce-internal-schema-boundary";
    const signature = createHmac("sha256", secret)
      .update([
        "POST",
        "/internal/nexa/payments/apply",
        timestamp,
        nonce,
        createHash("sha256").update(rawBody).digest("hex"),
      ].join("\n"))
      .digest("hex");
    let registrationCalls = 0;
    let failureCode: string | undefined;
    const handler = createNexaPaymentHandler({
      secret,
      now: () => now,
      dependencies: {
        withCreditLock: (creditoId, work) => withPaymentAdvisoryLock(creditoId, work),
        claim: async () => ({ kind: "new", eventId: 7 }),
        loadCredit: async () => ({
          usuarioId: 5,
          statusCredit: "ACTIVO",
          binding: { activo: true, expires_at: null, max_payment_amount: null },
        }),
        findPayments: async () => [],
        registerPayment: async (...args) => {
          registrationCalls += 1;
          return nexaPaymentDependencies.registerPayment(...args);
        },
        applyPayment: async () => ({ success: true }),
        complete: async () => undefined,
        fail: async (_eventId, code) => { failureCode = code; },
      },
    });
    const set: { status?: number | string } = {};
    const result = await handler({
      request: new Request("http://localhost/internal/nexa/payments/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexa-timestamp": timestamp,
          "x-nexa-nonce": nonce,
          "x-nexa-signature": signature,
        },
        body: rawBody,
      }),
      body: undefined,
      set,
    });

    expect(registrationCalls).toBe(1);
    expect(set.status).toBe(503);
    expect(result).toEqual({ error: "payment_outcome_uncertain" });
    expect(failureCode).toBe("payment_outcome_uncertain");
  } finally {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);

integrationTest("revalida bajo el lock canónico antes del primer efecto de pago", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false, max: 1 });
  const creditoId = 10;
  let blockerHeld = false;

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;
    await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, saldo integer NOT NULL DEFAULT 0)`;
    await sql`INSERT INTO cartera.creditos (credito_id) VALUES (${creditoId})`;
    await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY)`;
    await sql`
      CREATE TABLE cartera.nexa_credit_bindings (
        credito_id integer PRIMARY KEY,
        activo boolean NOT NULL,
        expires_at timestamptz,
        max_payment_amount numeric(18, 2),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`INSERT INTO cartera.nexa_credit_bindings (credito_id, activo) VALUES (${creditoId}, true)`;
    await sql`SELECT pg_advisory_lock(8765, ${creditoId})`;
    blockerHeld = true;

    process.env.RESEND_API_KEY = "re_test_only";
    process.env.EMAIL_DOMAIN = "example.test";
    const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
    const { NexaPaymentError } = await import("./nexaPayments");
    let validated = false;
    let settled = false;
    let registrationResult: Awaited<ReturnType<typeof nexaPaymentDependencies.registerPayment>> | undefined;
    const resultPromise = nexaPaymentDependencies.withCreditLock(creditoId, async (paymentLock) => {
      registrationResult = await nexaPaymentDependencies.registerPayment(
        {
          externalReference: "binding-race",
          creditoId,
          amount: "10.00",
          currency: "GTQ",
          tokenDate: "2026-09-08T23:30:00-06:00",
          transactionId: "binding-race",
        },
        7,
        5,
        async () => {
          validated = true;
          const [binding] = await sql<{ activo: boolean }[]>`
            SELECT activo FROM cartera.nexa_credit_bindings WHERE credito_id = ${creditoId}
          `;
          if (!binding?.activo) throw new NexaPaymentError("binding_inactive", 403);
        },
        paymentLock,
      );
      return { paymentId: 0, idempotent: false };
    }).finally(() => { settled = true; });

    await Bun.sleep(50);
    expect(validated).toBe(false);
    expect(settled).toBe(false);

    await sql`UPDATE cartera.nexa_credit_bindings SET activo = false WHERE credito_id = ${creditoId}`;
    await sql`SELECT pg_advisory_unlock(8765, ${creditoId})`;
    blockerHeld = false;
    await expect(resultPromise).resolves.toEqual({ paymentId: 0, idempotent: false });
    expect(registrationResult).toEqual({
      success: false,
      code: "binding_inactive",
      status: 403,
    });
    expect(validated).toBe(true);
    const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM cartera.pagos_credito`;
    expect(count).toBe("0");

    await sql`UPDATE cartera.nexa_credit_bindings SET activo = true WHERE credito_id = ${creditoId}`;
    const updater = postgres(testDatabaseUrl!, { ssl: false, max: 1 });
    let releaseWork: (() => void) | undefined;
    const workBlocked = new Promise<void>((resolve) => { releaseWork = resolve; });
    let entered: (() => void) | undefined;
    const workEntered = new Promise<void>((resolve) => { entered = resolve; });
    const holding = nexaPaymentDependencies.withCreditLock(creditoId, async () => {
      entered?.();
      await workBlocked;
      return { paymentId: 0, idempotent: false };
    });
    await workEntered;
    let updateSettled = false;
    const update = updater`
      UPDATE cartera.nexa_credit_bindings SET activo = false WHERE credito_id = ${creditoId}
    `.then(() => { updateSettled = true; });
    await Bun.sleep(50);
    expect(updateSettled).toBe(false);
    releaseWork?.();
    await holding;
    await update;
    expect(updateSettled).toBe(true);

    const creditUpdate = nexaPaymentDependencies.withCreditLock(creditoId, async () => {
      await updater`UPDATE cartera.creditos SET saldo = saldo + 1 WHERE credito_id = ${creditoId}`;
      return { paymentId: 0, idempotent: false };
    });
    const creditUpdateResult = await Promise.race([
      creditUpdate.then(() => "settled"),
      Bun.sleep(100).then(() => "timeout"),
    ]);
    expect(creditUpdateResult).toBe("settled");
    await updater.end();
  } finally {
    if (blockerHeld) {
      await sql`SELECT pg_advisory_unlock(8765, ${creditoId})`.catch(() => undefined);
    }
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);

integrationTest("la reconciliación Nexa cuenta mora y otros una sola vez", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.EMAIL_DOMAIN = "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false });

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;
    await sql`
      CREATE TABLE cartera.pagos_credito (
        pago_id serial PRIMARY KEY,
        credito_id integer NOT NULL,
        nexa_payment_event_id integer NOT NULL,
        validation_status text NOT NULL DEFAULT 'pending',
        monto_aplicado numeric(18, 2) NOT NULL DEFAULT 0,
        mora numeric(18, 2) NOT NULL DEFAULT 0,
        otros text NOT NULL DEFAULT '0',
        abono_capital numeric(18, 2) NOT NULL DEFAULT 0,
        abono_interes numeric(18, 2) NOT NULL DEFAULT 0,
        abono_iva_12 numeric(18, 2) NOT NULL DEFAULT 0,
        abono_seguro numeric(18, 2) NOT NULL DEFAULT 0,
        abono_gps numeric(18, 2) NOT NULL DEFAULT 0,
        membresias_pago numeric(18, 2) NOT NULL DEFAULT 0
      )
    `;
    await sql`
      INSERT INTO cartera.pagos_credito
        (credito_id, nexa_payment_event_id, monto_aplicado, mora, otros, abono_capital)
      VALUES
        (9488, 700, 30.00, 5.38, '15.00', 15.00),
        (9488, 701, 0.00, 0.00, '12.50', 0.00),
        (9488, 702, 30.00, 0.00, '15.00', 15.00),
        (9488, 703, 15.00, 5.38, '0', 15.00),
        (9488, 703, 15.00, 0.00, '0', 15.00)
    `;

    const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
    await expect(nexaPaymentDependencies.findPayments(700, 9488)).resolves.toEqual([
      { paymentId: 1, validationStatus: "pending", amount: "35.38" },
    ]);
    await expect(nexaPaymentDependencies.findPayments(701, 9488)).resolves.toEqual([
      { paymentId: 2, validationStatus: "pending", amount: "12.50" },
    ]);
    await expect(nexaPaymentDependencies.findPayments(702, 9488)).resolves.toEqual([
      { paymentId: 3, validationStatus: "pending", amount: "30.00" },
    ]);
    const allocations = await nexaPaymentDependencies.findPayments(703, 9488);
    expect(allocations).toEqual([
      { paymentId: 4, validationStatus: "pending", amount: "20.38" },
      { paymentId: 5, validationStatus: "pending", amount: "15.00" },
    ]);
    expect(allocations.reduce((total, payment) => total.plus(payment.amount), new Big(0)).toFixed(2))
      .toBe("35.38");
  } finally {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);

integrationTest("la aplicación confiable no readquiere el lock canónico ya sostenido", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.EMAIL_DOMAIN = "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, max: 1 });
  const creditoId = 10;
  let blockerHeld = false;
  let applyPromise: Promise<unknown> | undefined;

  try {
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql`CREATE SCHEMA cartera`;
    await sql`CREATE TABLE cartera.pagos_credito (pago_id integer PRIMARY KEY, credito_id integer)`;
    await sql`INSERT INTO cartera.pagos_credito (pago_id, credito_id) VALUES (1, ${creditoId})`;
    await sql`SELECT pg_advisory_lock(8765, ${creditoId})`;
    blockerHeld = true;

    const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
    const { withPaymentAdvisoryLock } = await import("../utils/paymentAdvisoryLock");
    applyPromise = withPaymentAdvisoryLock(creditoId, (paymentLock) =>
      nexaPaymentDependencies.applyPayment(1, paymentLock)
    );
    const blocked = await Promise.race([
      applyPromise.then(() => "settled", () => "settled"),
      Bun.sleep(50).then(() => "timeout"),
    ]);
    expect(blocked).toBe("timeout");

    await sql`SELECT pg_advisory_unlock(8765, ${creditoId})`;
    blockerHeld = false;
    const released = await Promise.race([
      applyPromise.then(() => "settled", () => "settled"),
      Bun.sleep(100).then(() => "timeout"),
    ]);
    expect(released).toBe("settled");
  } finally {
    if (blockerHeld) {
      await sql`SELECT pg_advisory_unlock(8765, ${creditoId})`.catch(() => undefined);
    }
    await applyPromise?.catch(() => undefined);
    await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
    await sql.end();
  }
}, 30_000);

integrationTest("inbox reiniciado factura una sola vez después de aprobación bancaria; unknown queda cerrado", async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const { createDb } = await import("../../../nexa-server/src/db");
  const { DbPaymentTransactionRepository, DbReviewRepository } = await import("../../../nexa-server/src/db/repositories");
  const { runApplicationWorkerOnce } = await import("../../../nexa-server/src/payments/application-worker");
  const { runReviewWorkerOnce } = await import("../../../nexa-server/src/payments/review-worker");
  const { HttpCarteraPaymentClient } = await import("../../../nexa-server/src/payments/cartera-client");
  const { createNexaPaymentHandler } = await import("./nexaPayments");
  const { claimNexaPaymentEvent } = await import("./nexaPaymentRepository");
  const { runNexaBilling } = await import("./nexaBilling");
  const { nexaPaymentDependencies, startNexaBilling } = await import("./nexaPaymentRuntime");
  const { withPaymentAdvisoryLock } = await import("../utils/paymentAdvisoryLock");
  const db = createDb(testDatabaseUrl!);
  const query = db.$client;
  const secret = "synthetic-local-only-secret".repeat(2);
  const options = { leaseSeconds: 10, maxAttempts: 3, backoffSeconds: 1, maxBackoffSeconds: 2 };
  let now = new Date("2026-09-08T12:00:00Z");
  let enabled = false;
  let unknown = false;
  let invoices = 0;
  let registrations = 0;
  let applications = 0;
  let approvals = 0;
  const bodies: string[] = [];
  try {
    await query.query(`DROP SCHEMA IF EXISTS cartera CASCADE; CREATE SCHEMA cartera;
      CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY);
      CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, validated boolean NOT NULL DEFAULT false);
      INSERT INTO cartera.creditos VALUES (10);`);
    await query.query(await Bun.file(new URL("../../drizzle/0039_add_nexa_internal_payments.sql", import.meta.url)).text());
    for (const file of ["0000_aspiring_mimic", "0001_mute_shockwave", "0002_durable_inbox", "0003_durable_reviews", "0004_classify_legacy_pending"]) {
      await query.query(await Bun.file(new URL(`../../../nexa-server/drizzle/${file}.sql`, import.meta.url)).text());
    }
    await query.query(`INSERT INTO nexa_payment_tokens (nexa_token_id, prefix, account, name) VALUES (1, '1234567', 'local', 'local');
      INSERT INTO nexa_token_users (payment_token_id, credito_id, identifier, description, national_id, nexa_user_id, token)
      VALUES (1, 10, '10005010', 'local', 'local', 1, '123456710005010');`);
    const handler = createNexaPaymentHandler({ secret, now: () => now.getTime(), dependencies: {
      ...nexaPaymentDependencies,
      withCreditLock: (creditoId, work) => withPaymentAdvisoryLock(creditoId, work),
      claim: (body, context) => claimNexaPaymentEvent(query, body, context),
      loadCredit: async () => ({ usuarioId: 1, statusCredit: "ACTIVO", binding: { activo: true, expires_at: null, max_payment_amount: null } }),
      findPayments: async (eventId) => (await query.query<{ paymentId: number; validationStatus: string; amount: string }>(
        `SELECT pago_id AS "paymentId", CASE WHEN validated THEN 'validated' ELSE 'pending' END AS "validationStatus", '50.00' AS amount
         FROM cartera.pagos_credito WHERE nexa_payment_event_id = $1`, [eventId],
      )).rows,
      registerPayment: async (_body, eventId) => {
        registrations++;
        await query.query("INSERT INTO cartera.pagos_credito (nexa_payment_event_id) VALUES ($1)", [eventId]);
        return { success: true };
      },
      applyPayment: async (paymentId) => {
        applications++;
        await query.query("UPDATE cartera.pagos_credito SET validated = true WHERE pago_id = $1", [paymentId]);
        return { success: true };
      },
      billPayments: (eventId, paymentIds) => runNexaBilling({ enabled, eventId, paymentIds, start: startNexaBilling,
        invoice: async () => {
          invoices++;
          return unknown
            ? { status: 502, response: { success: false } }
            : { status: 200, response: { success: true, data: { total_facturas: 1, facturas: [{ factura_id: invoices }] } } };
        },
      }),
    } });
    const cartera = new HttpCarteraPaymentClient({ baseUrl: "http://local-only.invalid", secret, clock: () => now.getTime(),
      fetch: async (url, init) => {
        bodies.push(String(init?.body));
        const set: { status?: number | string } = {};
        const response = await handler({ request: new Request(url, init), body: undefined, set });
        return Response.json(response, { status: Number(set.status) });
      },
    });
    const run = async () => {
      // Reconnect to PostgreSQL as a restarted worker: no pending work lives in memory.
      const restarted = createDb(testDatabaseUrl!);
      try {
        return await runApplicationWorkerOnce({ repository: new DbPaymentTransactionRepository(restarted), cartera, now: () => now, ...options });
      } finally { await restarted.$client.end(); }
    };
    for (const reference of ["4617307", "4617308"]) {
      enabled = false;
      unknown = reference === "4617308";
      const repository = new DbPaymentTransactionRepository(db);
      await repository.upsertReceived({ bank: "local", comments: "", account: "local", token: "123456710005010", tokenName: "local", reference, amount: 50, currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z", tokenIdentifier: "10005010", tokenPrefix: "1234567", transactionId: "7293", wasReturn: 0 });
      expect(await run()).toBe(true);
      expect(await runReviewWorkerOnce({ repository: new DbReviewRepository(db), now: () => now, ...options,
        nexa: { reviewTransfer: async (payload) => { approvals++; return payload; } },
      })).toBe(true);
      for (let wait = 0; wait < 5; wait++) {
        now = new Date(now.getTime() + 2_000);
        expect(await run()).toBe(true);
      }
      enabled = true;
      now = new Date(now.getTime() + 2_000);
      expect(await run()).toBe(true);
      now = new Date(now.getTime() + 60_000);
      expect(await run()).toBe(false);
      const [payment] = (await query.query("SELECT processing_status, failure_reason, next_attempt_at, lease_until FROM nexa_payment_transactions WHERE reference = $1", [reference])).rows;
      expect(payment).toEqual({ processing_status: "COMPLETED", failure_reason: unknown ? "billing_reconciliation_required" : null, next_attempt_at: null, lease_until: null });
      expect((await query.query("SELECT status FROM cartera.nexa_payment_events WHERE external_reference = $1", [reference])).rows[0]?.status).toBe(unknown ? "billing_unknown" : "billed");
      expect(new Set(bodies).size).toBe(1);
      // A replay after an unknown fiscal outcome must not reach the provider again.
      const replay = () => cartera.applyNexaPayment({ creditoId: 10, transaction: { reference, amount: 50, currency: "GTQ", tokenDate: "2026-09-08T12:00:00Z", transactionId: "7293" } });
      if (unknown) await expect(replay()).rejects.toThrow();
      else expect(await replay()).toMatchObject({ status: "APPLIED", idempotent: true });
      bodies.length = 0;
    }
    expect({ registrations, applications, invoices, approvals }).toEqual({ registrations: 2, applications: 2, invoices: 2, approvals: 2 });
    expect((await query.query("SELECT id FROM nexa_reviews")).rows).toHaveLength(2);
  } finally {
    await query.query("DROP SCHEMA IF EXISTS cartera CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await query.end();
  }
}, 30_000);
