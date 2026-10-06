import { afterAll, expect, spyOn, test } from "bun:test";
import postgres from "postgres";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// La condonación a tiempo de un pago Nexa contra Postgres REAL, con las
// migraciones 0043 (ledger) y 0051 (esta) aplicadas tal cual:
//  - con el candado del binding sostenido (FOR KEY SHARE en otra conexión) no
//    se cuelga — toma `creditos` con FOR NO KEY UPDATE;
//  - el reintento del mismo evento no condona dos veces;
//  - la anulación compensa el ledger, restituye la mora y libera el evento;
//  - si el cron cambió `monto_mora` desde la decisión, no condona;
//  - la saga de processNexaPayment: si el registro revienta con un error
//    genérico y no quedó ninguna fila de pago, anula la condonación.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{
  sql: Sql;
  latefee: typeof import("./latefee");
  lock: typeof import("../utils/paymentAdvisoryLock");
  database: typeof import("../database");
}> | undefined;

const migracion = (nombre: string) => Bun.file(new URL(`../../drizzle/${nombre}`, import.meta.url)).text();

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
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id))`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id))`;
  // Solo lo que lee `condonacionNexaDelPago` para el 503. Vacía: estas pruebas
  // no miran el campo `condonacion` (lo cubre nexaCondonacionIncierta), pero la
  // lectura tiene que poder correr; si falla, el 503 dice "sin_verificar".
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
  // Solo las columnas que lee `findPayments` del runtime.
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer REFERENCES cartera.creditos(credito_id), validation_status text,
    monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    nexa_payment_event_id integer, createdat timestamp DEFAULT now(),
    "paymentFalse" boolean NOT NULL DEFAULT false)`;
  await sql.unsafe(await migracion("0043_mora_pagada_cuota.sql")).simple();
  // 0051 dos veces: tiene que ser idempotente.
  await sql.unsafe(await migracion("0051_condonacion_nexa_a_tiempo.sql")).simple();
  await sql.unsafe(await migracion("0051_condonacion_nexa_a_tiempo.sql")).simple();
  await sql.unsafe(await migracion("0052_condonacion_nexa_pagos_pendientes.sql")).simple();
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    await sql`INSERT INTO cartera.creditos VALUES (${id}, ${`S-${id}`}, 'MOROSO', 10000)`;
    await sql`INSERT INTO cartera.cuotas_credito VALUES (${id * 10 + 4}, ${id}), (${id * 10 + 5}, ${id})`;
    await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id})`;
    // 112.00 de una cuota vieja (legítima) + 7.47 de la cuota en ventana.
    await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas)
      VALUES (${id}, 119.47, 2)`;
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
const condonar = (latefee: typeof import("./latefee"), creditoId: number, eventId: number, esperado = "119.47") =>
  latefee.condonarMoraDeCuotas({
    credito_id: creditoId,
    montoMoraEsperado: esperado,
    monto: "7.47",
    cuotas: [{ cuota_id: creditoId * 10 + 5, monto: "7.466667" }],
    nexa_payment_event_id: eventId,
    motivo: "NEXA_ACH_A_TIEMPO",
  });

integrationTest("la migración 0051 crea el usuario de sistema inactivo y sin hash bcrypt", async () => {
  const { sql } = await setup();
  const usuarios = await sql`SELECT email, role, is_active, password_hash FROM cartera.platform_users`;
  expect(usuarios).toHaveLength(1);
  expect(usuarios[0]).toMatchObject({ email: "sistema-nexa@clubcashin.local", role: "CONTA", is_active: false });
  expect(usuarios[0]!.password_hash.startsWith("$2")).toBe(false);
});

integrationTest("condona con el candado del binding sostenido (no se cuelga) y deja la mora legítima activa", async () => {
  const { sql, latefee, lock } = await setup();
  const pago = lock.withPaymentAdvisoryLock(1, (paymentLock) =>
    lock.withPaymentBindingLock(paymentLock, 1, async () => condonar(latefee, 1, 501)));
  const desenlace = await Promise.race([pago.then(() => "termino"), sleep(5_000).then(() => "colgado")]);
  if (desenlace === "colgado") {
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await pago.catch(() => undefined);
  }
  expect(desenlace).toBe("termino");
  expect((await pago).kind).toBe("condonada");

  const [mora] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 1`;
  expect(mora).toEqual({ monto_mora: "112.00", activa: true });
  const [credito] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 1`;
  expect(credito!.statusCredit).toBe("MOROSO"); // lo baja la aplicación del pago, no la condonación
  const cond = await sql`SELECT condonacion_id, monto_condonacion, nexa_payment_event_id, anulada_at
    FROM cartera.moras_condonaciones WHERE credito_id = 1`;
  expect(cond).toHaveLength(1);
  expect(cond[0]).toMatchObject({ monto_condonacion: "7.47", nexa_payment_event_id: 501, anulada_at: null });
  const ledger = await sql`SELECT cuota_id, monto, tipo, condonacion_id, pago_id
    FROM cartera.mora_pagada_cuota WHERE credito_id = 1`;
  expect([...ledger]).toEqual([{ cuota_id: 15, monto: "7.466667", tipo: "CONDONACION",
    condonacion_id: cond[0]!.condonacion_id, pago_id: null }]);
  const hist = await sql`SELECT tipo_evento, origen, monto_anterior, monto_nuevo
    FROM cartera.moras_historial WHERE credito_id = 1`;
  expect([...hist]).toEqual([{ tipo_evento: "CONDONACION", origen: "CONDONACION_NEXA_A_TIEMPO",
    monto_anterior: "119.47", monto_nuevo: "112.00" }]);
});

integrationTest("reintento del mismo evento (secuencial y concurrente): una sola condonación", async () => {
  const { sql, latefee } = await setup();
  const otra = await condonar(latefee, 1, 501, "112.00");
  expect(otra.kind).toBe("ya_condonada");
  const paralelas = await Promise.all([condonar(latefee, 2, 502), condonar(latefee, 2, 502)]);
  expect(paralelas.map((r) => r.kind).sort()).toEqual(["condonada", "ya_condonada"]);
  for (const credito of [1, 2]) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id = ${credito}`;
    expect(n).toBe(1);
    const [mora] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${credito}`;
    expect(mora!.monto_mora).toBe("112.00");
  }
  // La base es la red final: una segunda viva del mismo evento choca.
  let choco = false;
  try {
    await sql`INSERT INTO cartera.moras_condonaciones
      (credito_id, mora_id, motivo, monto_condonacion, usuario_id, nexa_payment_event_id)
      SELECT 2, mora_id, 'x', 1, (SELECT id FROM cartera.platform_users LIMIT 1), 502
      FROM cartera.moras_credito WHERE credito_id = 2`;
  } catch (error) {
    choco = (error as { code?: string }).code === "23505";
  }
  expect(choco).toBe(true);
});

integrationTest("rechazo definitivo: la anulación compensa el ledger, restituye la mora y libera el evento", async () => {
  const { sql, latefee } = await setup();
  const r = await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: 501, motivo: "rechazo" });
  expect(r).toEqual({ anulada: true, monto: "7.47" });
  const [mora] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 1`;
  expect(mora).toEqual({ monto_mora: "119.47", activa: true });
  const [cond] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 501`;
  expect(cond!.anulada_at).not.toBeNull();
  const [{ saldo }] = await sql`SELECT COALESCE(SUM(monto),0)::text AS saldo
    FROM cartera.mora_pagada_cuota WHERE credito_id = 1`;
  expect(Number(saldo)).toBe(0);
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 1 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
  const hist = await sql`SELECT tipo_evento, origen FROM cartera.moras_historial WHERE credito_id = 1 ORDER BY historial_id`;
  expect(hist.map((h) => h.tipo_evento)).toEqual(["CONDONACION", "INCREMENTO"]);
  // La restitución de la condonación no se ve como un ajuste manual (API_MANUAL).
  expect(hist.map((h) => h.origen)).toEqual(["CONDONACION_NEXA_A_TIEMPO", "CONDONACION_NEXA_A_TIEMPO"]);

  // Segunda anulación: no hace nada.
  expect(await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: 501, motivo: "rechazo" }))
    .toEqual({ anulada: false });
  // Un reintento posterior del evento puede volver a decidir (la anulada no ocupa el índice).
  expect((await condonar(latefee, 1, 501)).kind).toBe("condonada");
});

integrationTest("si monto_mora cambió desde la decisión (el cron corrió), no condona", async () => {
  const { sql, latefee } = await setup();
  const r = await condonar(latefee, 3, 503, "100.00");
  expect(r).toEqual({ kind: "sin_cambio", razon: "mora_cambio" });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id = 3`;
  expect(n).toBe(0);
});

integrationTest("la anulación restituye el monto condonado exacto, sin pasar por Number", async () => {
  // monto_condonacion admite 16 enteros: Number("9007199254740991.99") = 9007199254740992 y la
  // mora quedaría en ...992.01 mientras el ledger compensó el original.
  const { sql, latefee } = await setup();
  await sql`UPDATE cartera.moras_credito SET monto_mora = 0.01 WHERE credito_id = 3`;
  await sql`INSERT INTO cartera.moras_condonaciones
    (credito_id, mora_id, motivo, monto_condonacion, usuario_id, nexa_payment_event_id)
    SELECT 3, mora_id, 'NEXA_ACH_A_TIEMPO', 9007199254740991.99, (SELECT id FROM cartera.platform_users LIMIT 1), 599
    FROM cartera.moras_credito WHERE credito_id = 3`;
  const r = await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: 599, motivo: "rechazo" });
  expect(r).toEqual({ anulada: true, monto: "9007199254740991.99" });
  const [mora] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 3`;
  expect(mora!.monto_mora).toBe("9007199254740992.00");
  const [hist] = await sql`SELECT monto_anterior, monto_nuevo FROM cartera.moras_historial
    WHERE credito_id = 3 ORDER BY historial_id DESC LIMIT 1`;
  expect(hist).toEqual({ monto_anterior: "0.01", monto_nuevo: "9007199254740992.00" });
});

integrationTest("saga: el registro lanza un error genérico y no quedó ninguna fila de pago → la condonación se anula", async () => {
  const { sql, latefee } = await setup();
  const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  const fallos: string[] = [];
  const pago = processNexaPayment(
    {
      externalReference: "ach-504",
      creditoId: 4,
      amount: "1000.00",
      currency: "GTQ",
      tokenDate: "2026-10-07T00:00:00Z",
      token: "1111222233334444",
    },
    { nonce: "n-504", payloadHash: "b".repeat(64), now: new Date() },
    {
      ...nexaPaymentDependencies,
      // Reales: findPayments (pagos_credito por nexa_payment_event_id) y la anulación.
      withCreditLock: async (_creditoId, work) => work({} as PaymentAdvisoryLock),
      claim: async () => ({ kind: "new", eventId: 504 }),
      loadCredit: async () => ({
        usuarioId: 1,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      condonarMoraATiempo: async (_body, eventId) => {
        const r = await condonar(latefee, 4, eventId);
        return r.kind === "sin_cambio" ? undefined : { monto: r.monto };
      },
      registerPayment: async () => { throw new Error("db blip"); },
      fail: async (_eventId, code) => { fallos.push(code); },
    },
  );
  // Sigue siendo incierto para nexa-server (manual_review), pero sin condonación viva.
  await expect(pago).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  expect(fallos).toEqual(["payment_outcome_uncertain"]);

  const cond = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 504`;
  expect(cond).toHaveLength(1);
  expect(cond[0]!.anulada_at).not.toBeNull();
  const [mora] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 4`;
  expect(mora).toEqual({ monto_mora: "119.47", activa: true });
  const [{ saldo }] = await sql`SELECT COALESCE(SUM(monto),0)::text AS saldo
    FROM cartera.mora_pagada_cuota WHERE credito_id = 4`;
  expect(Number(saldo)).toBe(0);
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 4 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
});

integrationTest("el proceso murió tras condonar: la nueva entrega del evento (processing → manual_review) anula la condonación si no hay filas de pago, y la conserva si las hay", async () => {
  const { sql, latefee } = await setup();
  const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  // Estado que deja el pod muerto: condonación commiteada, ningún pago (crédito 5)
  // o el pago ya escrito (crédito 6, vinculado al evento).
  expect((await condonar(latefee, 5, 505)).kind).toBe("condonada");
  expect((await condonar(latefee, 6, 506)).kind).toBe("condonada");
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, nexa_payment_event_id)
    VALUES (6, 'pending', 1000.00, 506)`;
  const entregar = (creditoId: number, eventId: number) => processNexaPayment(
    {
      externalReference: `ach-${eventId}`,
      creditoId,
      amount: "1000.00",
      currency: "GTQ",
      tokenDate: "2026-10-07T00:00:00Z",
      token: "1111222233334444",
    },
    { nonce: `n-${eventId}-redelivery`, payloadHash: "b".repeat(64), now: new Date() },
    {
      ...nexaPaymentDependencies,
      // Reales: findPayments y la anulación. El claim es lo que devuelve
      // claimNexaPaymentEvent para un evento que quedó processing.
      withCreditLock: async (_creditoId, work) => work({} as PaymentAdvisoryLock),
      claim: async () => ({ kind: "manual_review", processingEventId: eventId }),
      loadCredit: async () => ({ usuarioId: 1, statusCredit: "MOROSO", binding: null }),
    },
  );
  // Hacia nexa-server sigue siendo incierto (503), nunca un rechazo.
  await expect(entregar(5, 505)).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  await expect(entregar(6, 506)).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));

  const [sinPago] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 505`;
  expect(sinPago!.anulada_at).not.toBeNull();
  const [mora5] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 5`;
  expect(mora5).toEqual({ monto_mora: "119.47", activa: true });
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 5 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);

  const [conPago] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 506`;
  expect(conPago!.anulada_at).toBeNull();
  const [mora6] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 6`;
  expect(mora6).toEqual({ monto_mora: "112.00" });
});

integrationTest("el proceso murió tras condonar y un operador registró la boleta A MANO (fila sin evento): la nueva entrega CONSERVA la condonación; un pago anterior a la condonación no lo impide", async () => {
  const { sql, latefee } = await setup();
  const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
  const { NexaPaymentError, classifyNexaClaim, processNexaPayment } = await import("./nexaPayments");
  // Crédito 8: un pago viejo, anterior a la condonación (no es esta transferencia).
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, nexa_payment_event_id, createdat)
    VALUES (8, 'validated', 500.00, NULL, now()::timestamp - interval '3 days')`;
  expect((await condonar(latefee, 7, 507)).kind).toBe("condonada");
  expect((await condonar(latefee, 8, 508)).kind).toBe("condonada");
  // Crédito 7: el operador registra la misma transferencia a mano, sin vínculo al evento.
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, nexa_payment_event_id)
    VALUES (7, 'validated', 1000.00, NULL)`;
  const entregar = (creditoId: number, eventId: number) => {
    // El claim real de un evento que quedó processing.
    const claim = classifyNexaClaim(
      { id: eventId, credito_id: creditoId, amount: "1000.00", currency: "GTQ", payload_hash: "b".repeat(64), status: "processing", pago_id: null, pago_id_eliminado: null },
      false,
      { creditoId, amount: "1000.00", currency: "GTQ", payloadHash: "b".repeat(64) },
    );
    return processNexaPayment(
      { externalReference: `ach-${eventId}`, creditoId, amount: "1000.00", currency: "GTQ", tokenDate: "2026-10-07T00:00:00Z", token: "1111222233334444" },
      { nonce: `n-${eventId}-redelivery`, payloadHash: "b".repeat(64), now: new Date() },
      {
        ...nexaPaymentDependencies,
        withCreditLock: async (_c, work) => work({} as PaymentAdvisoryLock),
        claim: async () => claim,
        loadCredit: async () => ({ usuarioId: 1, statusCredit: "MOROSO", binding: null }),
      },
    );
  };
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(String(args[0])); };
  try {
    await expect(entregar(7, 507)).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
    await expect(entregar(8, 508)).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  } finally {
    console.error = original;
  }

  const [manual] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 507`;
  expect(manual!.anulada_at).toBeNull();
  const [mora7] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 7`;
  expect(mora7).toEqual({ monto_mora: "112.00" });
  expect(logs.some((l) => l.includes("viva_sin_verificar") && l.includes("pago_posterior_no_vinculado")
    && l.includes('"nexa_payment_event_id":507'))).toBe(true);

  const [previo] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 508`;
  expect(previo!.anulada_at).not.toBeNull();
  const [mora8] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 8`;
  expect(mora8).toEqual({ monto_mora: "119.47" });
});

integrationTest("un pago posterior ya ANULADO (paymentFalse) no impide anular la condonación", async () => {
  const { sql, latefee } = await setup();
  expect((await condonar(latefee, 9, 509)).kind).toBe("condonada");
  // Otro pago entró después de la condonación y luego se anuló: no es esta transferencia.
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, nexa_payment_event_id, "paymentFalse")
    VALUES (9, 'validated', 1000.00, NULL, true)`;
  expect(await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: 509, motivo: "caída" }))
    .toEqual({ anulada: true, monto: "7.47" });
  const [mora9] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 9`;
  expect(mora9).toEqual({ monto_mora: "119.47" });
});

integrationTest("rechazo definitivo con un pago posterior vivo no vinculado: el adaptador real propaga la negativa → 503 incierto, condonación viva; sin ese pago sigue siendo rechazo", async () => {
  const { sql, latefee } = await setup();
  const { nexaPaymentDependencies } = await import("./nexaPaymentRuntime");
  const { NexaPaymentError, processNexaPayment } = await import("./nexaPayments");
  const rechazar = (creditoId: number, eventId: number, fallos: string[]) => processNexaPayment(
    { externalReference: `ach-${eventId}`, creditoId, amount: "1000.00", currency: "GTQ", tokenDate: "2026-10-07T00:00:00Z", token: "1111222233334444" },
    { nonce: `n-${eventId}`, payloadHash: "b".repeat(64), now: new Date() },
    {
      ...nexaPaymentDependencies,
      // Reales: findPayments y el adaptador de anulación.
      withCreditLock: async (_c, work) => work({} as PaymentAdvisoryLock),
      claim: async () => ({ kind: "new", eventId }),
      loadCredit: async () => ({
        usuarioId: 1,
        statusCredit: "MOROSO",
        binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
      }),
      condonarMoraATiempo: async (_b, id) => {
        const r = await condonar(latefee, creditoId, id);
        // Crédito 10: el operador registra la misma transferencia a mano mientras tanto.
        if (creditoId === 10) {
          await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, nexa_payment_event_id)
            VALUES (10, 'validated', 1000.00, NULL)`;
        }
        return r.kind === "sin_cambio" ? undefined : { monto: r.monto };
      },
      registerPayment: async () => ({ success: false, code: "credit_not_payable", status: 409 }),
      fail: async (_e, code) => { fallos.push(code); },
    },
  );
  const fallos10: string[] = [];
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await expect(rechazar(10, 510, fallos10)).rejects.toEqual(new NexaPaymentError("payment_outcome_uncertain", 503));
  } finally {
    errores.mockRestore();
  }
  expect(fallos10).toEqual(["payment_outcome_uncertain"]);
  const [viva] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 510`;
  expect(viva!.anulada_at).toBeNull();

  const fallos11: string[] = [];
  await expect(rechazar(11, 511, fallos11)).rejects.toEqual(new NexaPaymentError("credit_not_payable", 409));
  expect(fallos11).toEqual(["credit_not_payable"]);
  const [anulada] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 511`;
  expect(anulada!.anulada_at).not.toBeNull();
});
