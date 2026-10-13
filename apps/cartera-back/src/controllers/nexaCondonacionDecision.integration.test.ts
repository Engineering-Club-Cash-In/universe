import { afterAll, expect, spyOn, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// `condonarMoraNexaATiempo` de punta a punta contra Postgres REAL: lee el
// crédito, la mora, las cuotas (con el EXISTS del cron), los pagos y los rubros,
// decide y condona. Las fechas son relativas a HOY en Guatemala: la cuota 5 de
// cada crédito venció ayer (1 día de mora = 3.73 sobre Q10,000 de capital) y el
// pago Nexa llega hoy por el monto exacto de la cuota.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{
  sql: Sql;
  hoy: string;
  runtime: typeof import("./nexaPaymentRuntime");
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
    numero_credito_sifco text UNIQUE, "statusCredit" text, capital numeric(18,2), cuota numeric(18,2))`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id),
    numero_cuota integer NOT NULL, fecha_vencimiento timestamp NOT NULL, pagado boolean NOT NULL DEFAULT false)`;
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
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer REFERENCES cartera.creditos(credito_id), cuota_id integer,
    validation_status text, "paymentFalse" boolean NOT NULL DEFAULT false, pagado boolean NOT NULL DEFAULT false,
    fecha_pago timestamp, monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    nexa_payment_event_id integer)`;
  await sql`CREATE TABLE cartera.ajuste_fecha_ideal_pago (id serial PRIMARY KEY, credito_id integer NOT NULL,
    monto_total numeric(18,2) NOT NULL, fecha_cobro timestamptz)`;
  await sql`CREATE TABLE cartera.rubros_tipos (tipo_id serial PRIMARY KEY, obligatorio boolean NOT NULL DEFAULT false)`;
  await sql`CREATE TABLE cartera.rubros (rubro_id serial PRIMARY KEY, credito_id integer NOT NULL,
    tipo_id integer NOT NULL, saldo_pendiente numeric(18,2) NOT NULL, activo boolean NOT NULL DEFAULT true,
    completado boolean NOT NULL DEFAULT false, anulado boolean NOT NULL DEFAULT false, created_at timestamp DEFAULT now())`;
  await sql.unsafe(await migracion("0043_mora_pagada_cuota.sql")).simple();
  await sql.unsafe(await migracion("0051_condonacion_nexa_a_tiempo.sql")).simple();
  await sql.unsafe(await migracion("0052_condonacion_nexa_pagos_pendientes.sql")).simple();
  const [{ hoy }] = await sql`SELECT to_char((now() AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') AS hoy`;
  return {
    sql,
    hoy: hoy as string,
    database: await import("../database"),
    runtime: await import("./nexaPaymentRuntime"),
  };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql, database } = await ready;
  await sql.end();
  await database.client.end();
  await database.lockPool.end();
});

/** Crédito MOROSO, capital 10,000, cuota 1,000: la 5 venció ayer (3.73 de mora), la 6 vence en un mes. */
const credito = async (sql: Sql, id: number) => {
  await sql`INSERT INTO cartera.creditos VALUES (${id}, ${`S-${id}`}, 'MOROSO', 10000, 1000)`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento) VALUES
    (${id * 10 + 5}, ${id}, 5, (now() AT TIME ZONE 'America/Guatemala')::date - 1),
    (${id * 10 + 6}, ${id}, 6, (now() AT TIME ZONE 'America/Guatemala')::date + 30)`;
  await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas) VALUES (${id}, 3.73, 1)`;
};
const pagoNexa = (hoy: string, creditoId: number, amount = "1000.00") => ({
  externalReference: `ach-${creditoId}`,
  creditoId,
  amount,
  currency: "GTQ" as const,
  tokenDate: `${hoy}T12:00:00Z`,
  token: "1111222233334444",
});
const condonaciones = async (sql: Sql, creditoId: number) =>
  [...await sql`SELECT monto_condonacion, motivo FROM cartera.moras_condonaciones WHERE credito_id = ${creditoId}`];

integrationTest("pago a tiempo que deja el crédito al día → condona la mora de la cuota en ventana", async () => {
  const { sql, hoy, runtime } = await setup();
  await credito(sql, 1);
  const r = await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 1), 101);
  expect(r).toEqual({ monto: "3.73" });
  expect(await condonaciones(sql, 1)).toEqual([{ monto_condonacion: "3.73", motivo: "NEXA_ACH_A_TIEMPO" }]);
});

integrationTest("si la lectura de rubros falla, NO condona (fail-safe) y lo deja en el log", async () => {
  const { sql, hoy, runtime } = await setup();
  await credito(sql, 2);
  // Un rubro vivo de 500 haría que el pago no alcance la cuota; si la lectura
  // falla y se toma como 0, la simulación daría el crédito por al día.
  await sql`INSERT INTO cartera.rubros_tipos (obligatorio) VALUES (true)`;
  await sql`INSERT INTO cartera.rubros (credito_id, tipo_id, saldo_pendiente) VALUES (2, 1, 500)`;
  await sql`ALTER TABLE cartera.rubros RENAME TO rubros_fuera`;
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const r = await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 2), 102);
    expect(r).toBeUndefined();
    expect(errores.mock.calls.flat().join(" ")).toContain("condonación a tiempo omitida");
  } finally {
    errores.mockRestore();
    await sql`ALTER TABLE cartera.rubros_fuera RENAME TO rubros`;
  }
  expect(await condonaciones(sql, 2)).toEqual([]);
  const [mora] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 2`;
  expect(mora!.monto_mora).toBe("3.73");
});

integrationTest("boleta pendiente de hace 30 días en una cuota vieja → no condona (el cron le sigue cobrando)", async () => {
  const { sql, hoy, runtime } = await setup();
  await credito(sql, 3);
  // Cuota 4 vencida hace 40 días, con una boleta pendiente (nunca validada) de
  // hace 30: el cron solo la cuenta 7 días, así que la cuota genera mora.
  // Mora = 112.00 (cuota 4, techo de 30 días) + 3.73 (cuota 5, ayer).
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento)
    VALUES (34, 3, 4, (now() AT TIME ZONE 'America/Guatemala')::date - 40)`;
  await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago,
    monto_aplicado, abono_capital, abono_interes, abono_iva_12)
    VALUES (3, 34, 'pending', true, (now() AT TIME ZONE 'America/Guatemala')::date - 30, 1000, 600, 300, 100)`;
  await sql`UPDATE cartera.moras_credito SET monto_mora = 115.73, cuotas_atrasadas = 2 WHERE credito_id = 3`;
  // Trae la mora legítima + la cuota 5; la cuota 4 sigue sin pagar.
  const r = await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 3, "1112.00"), 103);
  expect(r).toBeUndefined();
  expect(await condonaciones(sql, 3)).toEqual([]);

  // Control: la misma boleta de hace 3 días sí cubre la cuota 4 → condona.
  await sql`UPDATE cartera.pagos_credito SET fecha_pago = (now() AT TIME ZONE 'America/Guatemala')::date - 3 WHERE cuota_id = 34`;
  await sql`UPDATE cartera.moras_credito SET monto_mora = 3.73, cuotas_atrasadas = 1 WHERE credito_id = 3`;
  expect(await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 3), 104)).toEqual({ monto: "3.73" });
});

integrationTest("aplicado el pago, si el crédito NO quedó al día: alerta en el motivo + log de error, sin anular", async () => {
  const { sql, hoy, runtime } = await setup();
  await credito(sql, 4);
  expect(await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 4), 105)).toEqual({ monto: "3.73" });
  // El pago "aplicado" no cubrió la cuota 5 (p. ej. una carrera con otro pago):
  // no hay fila de pago que la cubra y sigue vencida.
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await runtime.verificarCondonacionNexaATiempo(4, 105);
    const log = errores.mock.calls.map((c) => String(c[0])).find((m) => m.includes("no_quedo_al_dia"));
    expect(JSON.parse(log!)).toMatchObject({
      level: "error", nexa_payment_event_id: 105, credito_id: 4, cuotas_vencidas: 1,
    });
    // Idempotente: una segunda pasada no duplica la marca.
    await runtime.verificarCondonacionNexaATiempo(4, 105);
  } finally {
    errores.mockRestore();
  }
  const cond = [...await sql`SELECT motivo, anulada_at, monto_condonacion FROM cartera.moras_condonaciones WHERE credito_id = 4`];
  expect(cond).toEqual([{
    motivo: "NEXA_ACH_A_TIEMPO — ALERTA: el crédito no quedó al día tras aplicar el pago",
    anulada_at: null,
    monto_condonacion: "3.73",
  }]);
});

integrationTest("aplicado el pago y el crédito al día: la verificación no toca nada ni alerta", async () => {
  const { sql, hoy, runtime } = await setup();
  await credito(sql, 5);
  expect(await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 5), 106)).toEqual({ monto: "3.73" });
  // El pago aplicado (validado) cubre la cuota 5.
  await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago, monto_aplicado)
    VALUES (5, 55, 'validated', true, now(), 1000)`;
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await runtime.verificarCondonacionNexaATiempo(5, 106);
    expect(errores).not.toHaveBeenCalled();
  } finally {
    errores.mockRestore();
  }
  expect(await condonaciones(sql, 5)).toEqual([{ monto_condonacion: "3.73", motivo: "NEXA_ACH_A_TIEMPO" }]);
});

integrationTest("verificación en un reintento sin condonación viva: no alerta aunque el crédito no esté al día", async () => {
  const { sql, runtime } = await setup();
  await credito(sql, 6);
  const errores = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await runtime.verificarCondonacionNexaATiempo(6, 107);
    expect(errores).not.toHaveBeenCalled();
  } finally {
    errores.mockRestore();
  }
  expect(await condonaciones(sql, 6)).toEqual([]);
});

integrationTest("cuota vencida con un parcial PENDIENTE de ventanilla: el pago Nexa que la completa no la cierra (cierre diferido) → no condona; con el parcial ya validado sí", async () => {
  const { sql, hoy, runtime } = await setup();
  await credito(sql, 9);
  // Q400 en ventanilla hoy, pendientes de validar (parcial: pagado=false). Nexa trae los Q600 que faltan.
  await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago,
    monto_aplicado, abono_capital, abono_interes, abono_iva_12)
    VALUES (9, 95, 'pending', false, (now() AT TIME ZONE 'America/Guatemala')::date, 400, 0, 300, 100)`;
  expect(await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 9, "600.00"), 109)).toBeUndefined();
  expect(await condonaciones(sql, 9)).toEqual([]);

  // Control: contabilidad ya validó el parcial → el pago Nexa sí cierra la cuota.
  await sql`UPDATE cartera.pagos_credito SET validation_status = 'validated' WHERE cuota_id = 95`;
  expect(await runtime.condonarMoraNexaATiempo(pagoNexa(hoy, 9, "600.00"), 110)).toEqual({ monto: "3.73" });
});
