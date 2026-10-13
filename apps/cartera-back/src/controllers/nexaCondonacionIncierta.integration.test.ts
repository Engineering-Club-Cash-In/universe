import { afterAll, expect, spyOn, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import postgres from "postgres";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";
import type { NexaClaim, NexaPaymentDependencies } from "./nexaPayments";

// Pago Nexa con registro a medias (filas vinculadas al evento, desenlace
// incierto → manual_review) contra Postgres REAL: la condonación a tiempo se
// decide por lo que realmente entró, con el criterio del cron
// (`evaluarCreditoAlDia`):
//  - el crédito no quedó al día → se anula;
//  - quedó al día → se conserva;
//  - hay un pago posterior no vinculado → la guarda la conserva.
// La respuesta a Nexa sigue siendo 503 payment_outcome_uncertain y trae
// `condonacion` con lo que pasó, también en el reintento del evento.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{
  sql: Sql;
  latefee: typeof import("./latefee");
  database: typeof import("../database");
  runtime: typeof import("./nexaPaymentRuntime");
  payments: typeof import("./nexaPayments");
}> | undefined;

const migracion = (nombre: string) => Bun.file(new URL(`../../drizzle/${nombre}`, import.meta.url)).text();
const CREDITOS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  // nexaPaymentRuntime arrastra el paquete de email, que exige estas al importar.
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TYPE cartera.mora_evento_origen AS ENUM
    ('PROCESO_AUTO','API_MANUAL','CONDONACION_INDIVIDUAL','CONDONACION_MASIVA')`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY,
    numero_credito_sifco text UNIQUE, "statusCredit" text, capital numeric(18,2))`;
  // Lo que lee `evaluarCreditoAlDia`: vencimiento y pagado de cada cuota.
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id),
    numero_cuota integer NOT NULL, fecha_vencimiento date NOT NULL, pagado boolean NOT NULL DEFAULT false)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id))`;
  // Solo lo que lee `condonacionNexaDelPago`.
  await sql`CREATE TABLE cartera.nexa_payment_events (id integer PRIMARY KEY,
    provider varchar(20) NOT NULL DEFAULT 'NEXA', external_reference varchar(150) NOT NULL)`;
  await sql`CREATE TABLE cartera.platform_users (id serial PRIMARY KEY,
    email varchar(150) NOT NULL UNIQUE, password_hash varchar(255) NOT NULL,
    role text NOT NULL, is_active boolean NOT NULL DEFAULT true)`;
  await sql`CREATE TABLE cartera.moras_credito (mora_id serial PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id),
    activa boolean NOT NULL DEFAULT true, porcentaje_mora numeric(5,2) NOT NULL DEFAULT 1.12,
    monto_mora numeric(18,2) NOT NULL DEFAULT 0, cuotas_atrasadas integer NOT NULL DEFAULT 0,
    created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`;
  await sql`CREATE TABLE cartera.moras_historial (historial_id serial PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id), mora_id integer,
    tipo_evento text NOT NULL, origen cartera.mora_evento_origen NOT NULL,
    monto_anterior numeric(18,2) NOT NULL DEFAULT 0, monto_nuevo numeric(18,2) NOT NULL DEFAULT 0,
    cuotas_atrasadas_anterior integer NOT NULL DEFAULT 0, cuotas_atrasadas_nuevas integer NOT NULL DEFAULT 0,
    capital_credito numeric(18,2), porcentaje_mora numeric(5,4), usuario_id integer, motivo text,
    pago_id integer, fecha timestamp NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE cartera.moras_condonaciones (condonacion_id serial PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
    mora_id integer NOT NULL REFERENCES cartera.moras_credito(mora_id) ON DELETE CASCADE,
    motivo text NOT NULL, monto_condonacion numeric(18,2) NOT NULL DEFAULT 0,
    usuario_id integer NOT NULL REFERENCES cartera.platform_users(id) ON DELETE CASCADE,
    fecha timestamp NOT NULL DEFAULT now())`;
  // Las columnas de `findPayments`, más las que mira `hasPaidPaymentSql`.
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer REFERENCES cartera.creditos(credito_id), cuota_id integer,
    validation_status text, pagado boolean NOT NULL DEFAULT false, fecha_pago timestamp DEFAULT now(),
    monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    nexa_payment_event_id integer, createdat timestamp DEFAULT now(),
    "paymentFalse" boolean NOT NULL DEFAULT false)`;
  await sql.unsafe(await migracion("0043_mora_pagada_cuota.sql")).simple();
  await sql.unsafe(await migracion("0051_condonacion_nexa_a_tiempo.sql")).simple();
  await sql.unsafe(await migracion("0052_condonacion_nexa_pagos_pendientes.sql")).simple();
  for (const id of CREDITOS) {
    await sql`INSERT INTO cartera.creditos VALUES (${id}, ${`S-${id}`}, 'MOROSO', 10000)`;
    // Cuota 4 vencida hace 20 días (la que el pago tiene que cubrir) y cuota 5 a futuro.
    await sql`INSERT INTO cartera.cuotas_credito VALUES
      (${id * 10 + 4}, ${id}, 4, CURRENT_DATE - 20, false),
      (${id * 10 + 5}, ${id}, 5, CURRENT_DATE + 10, false)`;
    await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id})`;
    await sql`INSERT INTO cartera.nexa_payment_events (id, external_reference) VALUES (${500 + id}, ${`ach-${500 + id}`})`;
    await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas)
      VALUES (${id}, 119.47, 1)`;
  }
  return {
    sql,
    database: await import("../database"),
    latefee: await import("./latefee"),
    runtime: await import("./nexaPaymentRuntime"),
    payments: await import("./nexaPayments"),
  };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql, database } = await ready;
  await sql.end();
  await database.client.end();
  await database.lockPool.end();
});

const condonar = (latefee: typeof import("./latefee"), creditoId: number, eventId: number) =>
  latefee.condonarMoraDeCuotas({
    credito_id: creditoId,
    montoMoraEsperado: "119.47",
    monto: "7.47",
    cuotas: [{ cuota_id: creditoId * 10 + 4, monto: "7.47" }],
    nexa_payment_event_id: eventId,
    motivo: "NEXA_ACH_A_TIEMPO",
  });

/** Una fila de pago vinculada al evento; `cubre` = cubre la cuota vencida (criterio del cron). */
const filaDePago = (sql: Sql, creditoId: number, eventId: number | null, monto: string, cubre: boolean) => sql`
  INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, monto_aplicado, nexa_payment_event_id)
  VALUES (${creditoId}, ${creditoId * 10 + 4}, 'validated', ${cubre}, ${monto}, ${eventId})`;

const SECRET = "s".repeat(32);
const NOW = Date.now();

/** Una entrega firmada al handler real, con la saga real salvo el registro y lo que se indique. */
const entregar = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  creditoId: number,
  opciones: {
    claim?: NexaClaim;
    nonce: string;
    registerPayment?: NexaPaymentDependencies["registerPayment"];
    fallos?: string[];
    extra?: Partial<NexaPaymentDependencies>;
  },
) => {
  const eventId = 500 + creditoId;
  const rawBody = JSON.stringify({
    externalReference: `ach-${eventId}`,
    creditoId,
    amount: "1000.00",
    currency: "GTQ",
    tokenDate: "2026-10-07T00:00:00Z",
    token: "1111222233334444",
  });
  const timestamp = String(Math.floor(NOW / 1000));
  const signature = createHmac("sha256", SECRET).update([
    "POST", "/internal/nexa/payments/apply", timestamp, opciones.nonce,
    createHash("sha256").update(rawBody).digest("hex"),
  ].join("\n")).digest("hex");
  const set: { status?: number | string } = {};
  const handler = ctx.payments.createNexaPaymentHandler({
    secret: SECRET,
    now: () => NOW,
    dependencies: {
      ...ctx.runtime.nexaPaymentDependencies,
      // Reales: findPayments, la reconciliación, la anulación, la verificación y
      // la lectura de la condonación para la respuesta.
      withCreditLock: async (_c, work) => work({} as PaymentAdvisoryLock),
      claim: async () => opciones.claim ?? { kind: "new", eventId },
      loadCredit: async () => ({
        usuarioId: 1,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      condonarMoraATiempo: async (_b, id) => {
        const r = await condonar(ctx.latefee, creditoId, id);
        return r.kind === "sin_cambio" ? undefined : { monto: r.monto };
      },
      registerPayment: opciones.registerPayment ?? (async () => ({ success: true })),
      fail: async (_e, code) => { opciones.fallos?.push(code); },
      ...opciones.extra,
    },
  });
  const body = await handler({
    request: new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: rawBody,
      headers: { "x-nexa-timestamp": timestamp, "x-nexa-nonce": opciones.nonce, "x-nexa-signature": signature },
    }),
    body: undefined,
    set,
  });
  return { status: set.status, body };
};

const estado = async (sql: Sql, creditoId: number) => {
  const [cond] = await sql`SELECT anulada_at, motivo FROM cartera.moras_condonaciones
    WHERE nexa_payment_event_id = ${500 + creditoId} ORDER BY condonacion_id DESC LIMIT 1`;
  const [mora] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${creditoId}`;
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = ${creditoId} ORDER BY id`;
  return {
    anulada: cond!.anulada_at !== null,
    motivo: String(cond!.motivo),
    mora: String(mora!.monto_mora),
    ledger: tipos.map((t) => t.tipo),
  };
};

integrationTest("registro a medias (monto que no cuadra) y el crédito NO quedó al día: se anula la condonación; 503 con condonacion=anulada", async () => {
  const ctx = await setup();
  const fallos: string[] = [];
  const logs = spyOn(console, "warn").mockImplementation(() => undefined);
  let r;
  try {
    r = await entregar(ctx, 1, {
      nonce: "n-501",
      fallos,
      // Entró una fila de 400 de los 1000, que no cubre la cuota vencida.
      registerPayment: async () => { await filaDePago(ctx.sql, 1, 501, "400.00", false); return { success: true }; },
    });
  } finally {
    logs.mockRestore();
  }
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "anulada" } });
  expect(fallos).toEqual(["payment_outcome_uncertain"]);
  expect(await estado(ctx.sql, 1)).toMatchObject({ anulada: true, mora: "119.47", ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("registro a medias (el registro revienta con una fila parcial ya escrita) y el crédito SÍ quedó al día: se conserva; 503 con condonacion=conservada", async () => {
  const ctx = await setup();
  const fallos: string[] = [];
  const logs = spyOn(console, "warn").mockImplementation(() => undefined);
  let r;
  try {
    r = await entregar(ctx, 2, {
      nonce: "n-502",
      fallos,
      registerPayment: async () => {
        // Entraron 600 de los 1000, pero alcanzan para cubrir la cuota vencida.
        await filaDePago(ctx.sql, 2, 502, "600.00", true);
        throw new Error("db blip después de escribir la fila");
      },
    });
  } finally {
    logs.mockRestore();
  }
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "conservada" } });
  expect(fallos).toEqual(["payment_outcome_uncertain"]);
  const e = await estado(ctx.sql, 2);
  expect(e).toMatchObject({ anulada: false, mora: "112.00", ledger: ["CONDONACION"] });
  expect(e.motivo).toContain("CONSERVADA: pago Nexa incierto, pero con lo que entró el crédito quedó al día");
});

integrationTest("registro a medias, no quedó al día, pero hay un pago manual posterior no vinculado: la guarda la conserva; 503 con condonacion=conservada_pago_posterior", async () => {
  const ctx = await setup();
  const fallos: string[] = [];
  const warns = spyOn(console, "warn").mockImplementation(() => undefined);
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  let r;
  try {
    r = await entregar(ctx, 3, {
      nonce: "n-503",
      fallos,
      registerPayment: async () => {
        // Un operador registró a mano (sin evento) algo que pudo ser esta transferencia.
        await filaDePago(ctx.sql, 3, null, "50.00", false);
        await filaDePago(ctx.sql, 3, 503, "400.00", false);
        return { success: true };
      },
    });
    expect(errores.mock.calls.some(([l]) => String(l).includes("pago_posterior_no_vinculado")
      && String(l).includes('"nexa_payment_event_id":503'))).toBe(true);
  } finally {
    warns.mockRestore();
    errores.mockRestore();
  }
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "conservada_pago_posterior" } });
  expect(fallos).toEqual(["payment_outcome_uncertain"]);
  const e = await estado(ctx.sql, 3);
  expect(e).toMatchObject({ anulada: false, mora: "112.00", ledger: ["CONDONACION"] });
  expect(e.motivo).toContain("CONSERVADA: hay un pago posterior no vinculado que pudo ser esta transferencia");
});

integrationTest("el reintento del evento (ya en manual_review, sin pasar por la saga) informa lo mismo que la primera respuesta", async () => {
  const ctx = await setup();
  for (const [creditoId, condonacion] of [[1, "anulada"], [2, "conservada"], [3, "conservada_pago_posterior"]] as const) {
    const r = await entregar(ctx, creditoId, { nonce: `n-${500 + creditoId}-retry`, claim: { kind: "manual_review" } });
    expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion } });
  }
});

integrationTest("el proceso murió con la fila ya escrita y el crédito no quedó al día: la nueva entrega (processing → manual_review) anula", async () => {
  const ctx = await setup();
  expect((await condonar(ctx.latefee, 4, 504)).kind).toBe("condonada");
  await filaDePago(ctx.sql, 4, 504, "400.00", false);
  const logs = spyOn(console, "warn").mockImplementation(() => undefined);
  let r;
  try {
    r = await entregar(ctx, 4, { nonce: "n-504-redelivery", claim: { kind: "manual_review", processingEventId: 504 } });
  } finally {
    logs.mockRestore();
  }
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "anulada" } });
  expect(await estado(ctx.sql, 4)).toMatchObject({ anulada: true, mora: "119.47", ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("un rechazo genuino sigue igual: 409 sin campo condonacion, y la condonación se anula", async () => {
  const ctx = await setup();
  const fallos: string[] = [];
  const r = await entregar(ctx, 5, {
    nonce: "n-505",
    fallos,
    registerPayment: async () => ({ success: false, code: "credit_not_payable", status: 409 }),
  });
  expect(r).toEqual({ status: 409, body: { error: "credit_not_payable" } });
  expect(fallos).toEqual(["credit_not_payable"]);
  expect(await estado(ctx.sql, 5)).toMatchObject({ anulada: true, mora: "119.47", ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("un pago completo sigue igual: 200 APPLIED y la condonación queda viva, sin marca", async () => {
  const ctx = await setup();
  const fallos: string[] = [];
  const completados: number[] = [];
  const r = await entregar(ctx, 6, {
    nonce: "n-506",
    fallos,
    registerPayment: async () => { await filaDePago(ctx.sql, 6, 506, "1000.00", true); return { success: true }; },
    extra: {
      complete: async (eventId) => { completados.push(eventId); },
      billPayments: async () => ({ kind: "pending", code: "billing_disabled" }),
    },
  });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ status: "APPLIED", idempotent: false, billingStatus: "PENDING" });
  expect(fallos).toEqual([]);
  expect(completados).toEqual([506]);
  const e = await estado(ctx.sql, 6);
  expect(e).toMatchObject({ anulada: false, mora: "112.00", ledger: ["CONDONACION"] });
  expect(e.motivo).toBe("NEXA_ACH_A_TIEMPO");
});

integrationTest("incierto sin condonación (nada que condonar): 503 sin campo condonacion", async () => {
  const ctx = await setup();
  const r = await entregar(ctx, 7, {
    nonce: "n-507",
    registerPayment: async () => { await filaDePago(ctx.sql, 7, 507, "400.00", false); return { success: true }; },
    extra: { condonarMoraATiempo: async () => undefined },
  });
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain" } });
  const [{ n }] = await ctx.sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id = 7`;
  expect(n).toBe(0);
});

integrationTest("SONDA A: el pago entró COMPLETO y el proceso murió; antes de la nueva entrega vence otra cuota: se CONSERVA (conservada), la mora no vuelve", async () => {
  const ctx = await setup();
  expect((await condonar(ctx.latefee, 8, 508)).kind).toBe("condonada");
  // La boleta entera (1000 de 1000), vinculada y validada, cubre la cuota 4.
  await filaDePago(ctx.sql, 8, 508, "1000.00", true);
  // Mientras tanto vence otra cuota sin pagar: HOY el crédito no está al día.
  await ctx.sql`INSERT INTO cartera.cuotas_credito VALUES (83, 8, 3, CURRENT_DATE - 2, false)`;
  const warns = spyOn(console, "warn").mockImplementation(() => undefined);
  let r;
  try {
    r = await entregar(ctx, 8, { nonce: "n-508-redelivery", claim: { kind: "manual_review", processingEventId: 508 } });
  } finally {
    warns.mockRestore();
  }
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "conservada" } });
  const e = await estado(ctx.sql, 8);
  expect(e).toMatchObject({ anulada: false, mora: "112.00", ledger: ["CONDONACION"] });
  expect(e.motivo).toContain("CONSERVADA: pago Nexa incierto, pero sus filas suman el monto completo");
});

integrationTest("SONDA A (control): el pago entró A MEDIAS y el crédito no está al día: se anula", async () => {
  const ctx = await setup();
  expect((await condonar(ctx.latefee, 9, 509)).kind).toBe("condonada");
  // 999.99 de 1000: a medias por un centavo (se compara con Big, no con float).
  await filaDePago(ctx.sql, 9, 509, "999.99", false);
  const warns = spyOn(console, "warn").mockImplementation(() => undefined);
  let r;
  try {
    r = await entregar(ctx, 9, { nonce: "n-509-redelivery", claim: { kind: "manual_review", processingEventId: 509 } });
  } finally {
    warns.mockRestore();
  }
  expect(r).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "anulada" } });
  expect(await estado(ctx.sql, 9)).toMatchObject({ anulada: true, mora: "119.47", ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("si no se pudo leer la condonación del pago, el 503 dice condonacion=sin_verificar; leída y sin condonación, va sin el campo", async () => {
  const ctx = await setup();
  const falla = await entregar(ctx, 7, {
    nonce: "n-507-lectura",
    claim: { kind: "manual_review" },
    extra: { condonacionDelPago: async () => { throw new Error("db blip al leer"); } },
  });
  expect(falla).toEqual({ status: 503, body: { error: "payment_outcome_uncertain", condonacion: "sin_verificar" } });
  // Crédito 7 no tiene condonación (ver la prueba de "incierto sin condonación").
  const sinCondonacion = await entregar(ctx, 7, { nonce: "n-507-lectura-ok", claim: { kind: "manual_review" } });
  expect(sinCondonacion).toEqual({ status: 503, body: { error: "payment_outcome_uncertain" } });
});
