import { test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// A NIVEL DE MÓDULO y antes de que nadie importe la app: `../database` lee SUPABASE_DB_URL al cargarse.
// Con base de pruebas se apunta a ella (y solo a ella); sin ella, una URL inalcanzable: nunca una base real.
if (testDatabaseUrl) {
  parseTestDatabaseUrl(testDatabaseUrl);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
} else {
  process.env.SUPABASE_DB_URL = "postgres://x:x@127.0.0.1:1/x";
}
process.env.RESEND_API_KEY ??= "re_test_only"; // el paquete de email lo exige al importar
process.env.EMAIL_DOMAIN ??= "example.test";
/** Sin TEST_DATABASE_URL se salta: mirar que el reporte diga `pass`, no `skip`. */
export const integrationTest = testDatabaseUrl ? test : test.skip;
export const EMAIL_ASESOR = "asesor.prueba@clubcashin.test";
export const uuidIntento = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Créditos sembrados: 1..CREDITOS. */
export const CREDITOS = 40;

export type Sql = ReturnType<typeof postgres>;
export type Entorno = {
  sql: Sql;
  latefee: typeof import("./latefee");
  lock: typeof import("../utils/paymentAdvisoryLock");
  database: typeof import("../database");
};

const migracion = (nombre: string) => Bun.file(new URL(`../../drizzle/${nombre}`, import.meta.url)).text();
let listo: Promise<Entorno> | undefined;

/**
 * Esquema mínimo + migraciones REALES 0043, 0051, 0052, 0053, 0054, 0055, 0056.
 * Créditos 1..CREDITOS: MOROSO, capital 10000, cuotas id*10+4 (vencida hace 40 días) e id*10+5 (hace 10; la del retraso), ambas impagas
 * y una mora activa de 119.47 = 112.00 legítima + 7.47 del retraso (cuota id*10+5).
 */
export const levantarEsquemaBoletaTardia = (): Promise<Entorno> => {
  // Sin URL, postgres.js usaría PG*/localhost y el DROP SCHEMA de abajo borraría esa base. Se rechaza FUERA de
  // `listo`: memorizar el rechazo haría lanzar al `afterAll(cerrarEsquemaBoletaTardia)` de los demás archivos.
  if (!testDatabaseUrl) return Promise.reject(new Error("levantarEsquemaBoletaTardia exige TEST_DATABASE_URL: nunca se conecta por defecto"));
  return levantar(testDatabaseUrl);
};
const levantar = (url: string): Promise<Entorno> => (listo ??= (async () => {
  const sql = postgres(url, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TYPE cartera.mora_evento_origen AS ENUM
    ('PROCESO_AUTO','API_MANUAL','CONDONACION_INDIVIDUAL','CONDONACION_MASIVA')`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY,
    numero_credito_sifco text UNIQUE, "statusCredit" text, capital numeric(18,2))`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id),
    fecha_vencimiento date, pagado boolean NOT NULL DEFAULT false)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (
    credito_id integer PRIMARY KEY REFERENCES cartera.creditos(credito_id))`;
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
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer REFERENCES cartera.creditos(credito_id), cuota_id integer,
    validation_status text, monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    nexa_payment_event_id integer, createdat timestamp DEFAULT now(),
    "paymentFalse" boolean NOT NULL DEFAULT false, pagado boolean NOT NULL DEFAULT false, fecha_pago timestamp)`;
  await sql`CREATE TABLE cartera.boletas (id serial PRIMARY KEY, pago_id integer NOT NULL REFERENCES cartera.pagos_credito(pago_id),
    url_boleta varchar(255) NOT NULL, created_at timestamp DEFAULT now())`;
  for (const archivo of [
    "0043_mora_pagada_cuota.sql", "0051_condonacion_nexa_a_tiempo.sql", "0052_condonacion_nexa_pagos_pendientes.sql",
    "0053_condonacion_boleta_tardia_enum.sql", "0054_condonacion_boleta_tardia_columnas.sql",
    "0055_condonacion_boleta_tardia_indice_pagos.sql", "0056_idx_condonaciones_intento.sql",
  ]) await sql.unsafe(await migracion(archivo)).simple();
  await sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active)
    VALUES (${EMAIL_ASESOR}, '!sin-login', 'ASESOR', true)`;
  for (let id = 1; id <= CREDITOS; id++) {
    await sql`INSERT INTO cartera.creditos VALUES (${id}, ${`S-${id}`}, 'MOROSO', 10000)`;
    await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, fecha_vencimiento)
      VALUES (${id * 10 + 4}, ${id}, current_date - 40), (${id * 10 + 5}, ${id}, current_date - 10)`;
    await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id})`;
    await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas) VALUES (${id}, 119.47, 2)`;
  }
  const database = await import("../database");
  if (database.client.options.connectionString !== testDatabaseUrl) {
    throw new Error("La app quedó conectada a otra base que TEST_DATABASE_URL; se aborta antes de tocar nada");
  }
  return {
    sql,
    database,
    latefee: await import("./latefee"),
    lock: await import("../utils/paymentAdvisoryLock"),
  };
})());

/**
 * Cierra SOLO la conexión de la prueba y deja que el siguiente archivo vuelva a levantar el esquema.
 * NO cierra `database.client` ni `database.lockPool`: `../database` es un módulo compartido por todos los archivos
 * de la corrida y cerrarlos dejaría sin conexión al siguiente archivo de integración; el proceso termina igual.
 */
export async function cerrarEsquemaBoletaTardia() {
  if (!listo) return;
  const { sql } = await listo;
  listo = undefined;
  await sql.end();
}

/** Condona 7.47 de los 119.47 del crédito (la cuota id*10+5), a nombre del asesor de pruebas. */
export const condonarBT = (
  latefee: typeof import("./latefee"),
  creditoId: number,
  intentoId: string,
  esperado = "119.47",
) => latefee.condonarMoraDeCuotas({
  credito_id: creditoId,
  montoMoraEsperado: esperado,
  monto: "7.47",
  cuotas: [{ cuota_id: creditoId * 10 + 5, monto: "7.466667" }],
  origen: "CONDONACION_BOLETA_TARDIA",
  intento_id: intentoId,
  usuario_email: EMAIL_ASESOR,
  motivo: `Boleta del 30-sep registrada el 03-oct, cuota 5, aceptada por ${EMAIL_ASESOR}`,
});
