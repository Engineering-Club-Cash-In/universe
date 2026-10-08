import { beforeAll, expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Alcance por asesor del dashboard Nexa contra el SQL real: un ASESOR solo ve los créditos con
// su creditos.asesor_id (aunque pida otro), sin vínculo no ve nada, y los totales, la paginación
// y el detalle de pagos respetan el alcance. Corre aparte de nexaDashboard.integration.test.ts:
// los dos rehacen el schema cartera.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const dash = { q: "", page: 1, pageSize: 50, cuotaMes: "" as const, medio: "" as const, desde: "", hasta: "" };

type Sql = ReturnType<typeof postgres>;
let sql: Sql;
let mod: typeof import("./nexaDashboard");

// Créditos: 201 y 202 del asesor 1, 301 del asesor 2, 401 sin asesor.
const DEL_1 = [201, 202];
const DEL_2 = [301];

beforeAll(async () => {
  if (!testDatabaseUrl) return;
  parseTestDatabaseUrl(testDatabaseUrl);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  sql = postgres(testDatabaseUrl, { ssl: false });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.usuarios (usuario_id integer PRIMARY KEY, nombre text)`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, usuario_id integer,
    numero_credito_sifco text, "statusCredit" text, cuota numeric(18,2) NOT NULL DEFAULT 1000, asesor_id integer)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, numero_cuota integer, credito_id integer, fecha_vencimiento date,
    pagado boolean DEFAULT false)`;
  await sql`CREATE TABLE cartera.bancos (banco_id integer PRIMARY KEY, nombre text)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (credito_id integer PRIMARY KEY, nexa_token text, activo boolean DEFAULT true)`;
  await sql`CREATE TABLE cartera.nexa_payment_events (id serial PRIMARY KEY, credito_id integer NOT NULL,
    external_reference text, amount numeric(18,2) NOT NULL, status text, pago_id integer, error text,
    created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer, cuota_id integer,
    fecha_pago timestamp, monto_boleta numeric(18,2), nexa_payment_event_id integer, registerby text,
    numeroautorizacion text, validation_status text, "paymentFalse" boolean, banco_id integer, monto_aplicado numeric(18,2),
    pagado boolean DEFAULT false)`;
  const creditos: [number, number | null, number][] = [[201, 1, 40], [202, 1, 50], [301, 2, 70], [401, null, 90]];
  for (const [id, asesor, monto] of creditos) {
    await sql`INSERT INTO cartera.usuarios VALUES (${id}, ${`Cliente ${id}`})`;
    await sql`INSERT INTO cartera.creditos VALUES (${id}, ${id}, ${`SIFCO-${id}`}, 'ACTIVO', 1000, ${asesor})`;
    await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id}, ${`tok${id}`}, true)`;
    const [e] = await sql`INSERT INTO cartera.nexa_payment_events (credito_id, external_reference, amount, status)
      VALUES (${id}, ${`ref-${id}`}, ${monto}, 'applied') RETURNING id`;
    await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, nexa_payment_event_id, validation_status)
      VALUES (${id}, 1, '2026-09-10 10:00:00', ${monto}, ${e!.id}, 'validated')`;
    await sql`UPDATE cartera.nexa_payment_events SET pago_id = (SELECT pago_id FROM cartera.pagos_credito
      WHERE nexa_payment_event_id = ${e!.id}) WHERE id = ${e!.id}`;
  }
  mod = await import("./nexaDashboard");
});

const ids = (r: { creditos: { creditoId: number }[] }) => r.creditos.map((c) => c.creditoId).sort();
const asesorSesion = (asesor_id: number | null, is_active = true) => ({ role: "ASESOR", is_active, asesor_id });

integrationTest("ADMIN sin filtro ve todos los créditos y los totales de todos", async () => {
  const r = await mod.getNexaDashboard(mod.resolverAlcanceNexa("ADMIN", null, null), dash);
  expect(ids(r)).toEqual([201, 202, 301, 401]);
  expect(r.totales).toMatchObject({ creditos: 4, pagosNexa: 4, montoNexa: "250.00" });
});

integrationTest("ADMIN con filtro de asesor ve solo los de ese asesor, y los totales también", async () => {
  const r = await mod.getNexaDashboard(mod.resolverAlcanceNexa("ADMIN", null, mod.parseAsesorFiltro("2")), dash);
  expect(ids(r)).toEqual(DEL_2);
  expect(r.totales).toMatchObject({ creditos: 1, conToken: 1, pagosNexa: 1, montoNexa: "70.00", ultimoPagoNexa: 1 });
});

integrationTest("ASESOR ve solo sus créditos aunque pida los de otro asesor", async () => {
  const alcance = mod.resolverAlcanceNexa("ASESOR", asesorSesion(1), mod.parseAsesorFiltro("2"));
  const r = await mod.getNexaDashboard(alcance, dash);
  expect(ids(r)).toEqual(DEL_1);
  expect(r.totales).toMatchObject({ creditos: 2, conToken: 2, pagosNexa: 2, montoNexa: "90.00", ultimoPagoNexa: 2 });
  // La búsqueda por número no abre la puerta a un crédito ajeno.
  expect((await mod.getNexaDashboard(alcance, { ...dash, q: "SIFCO-301" })).creditos).toEqual([]);
});

integrationTest("ASESOR: la paginación cuenta solo sus créditos", async () => {
  const alcance = mod.resolverAlcanceNexa("ASESOR", asesorSesion(1), null);
  const p1 = await mod.getNexaDashboard(alcance, { ...dash, pageSize: 1, page: 1 });
  const p2 = await mod.getNexaDashboard(alcance, { ...dash, pageSize: 1, page: 2 });
  const p3 = await mod.getNexaDashboard(alcance, { ...dash, pageSize: 1, page: 3 });
  expect(p1.total).toBe(2);
  expect([...ids(p1), ...ids(p2)].sort()).toEqual(DEL_1);
  expect(p3.creditos).toEqual([]);
  expect(p3.totales.creditos).toBe(2);
});

integrationTest("ASESOR sin vínculo (o inactivo, o sin fila) ve vacío y totales en cero", async () => {
  for (const sesion of [asesorSesion(null), asesorSesion(1, false), null]) {
    const r = await mod.getNexaDashboard(mod.resolverAlcanceNexa("ASESOR", sesion, mod.parseAsesorFiltro("1")), dash);
    expect(r.creditos).toEqual([]);
    expect(r.totales).toEqual({ creditos: 0, conToken: 0, pagosNexa: 0, montoNexa: "0", rechazosNexa: 0, ultimoPagoNexa: 0 });
  }
});

integrationTest("detalle: un ASESOR que pide un crédito ajeno recibe null (404), el suyo sí", async () => {
  const alcance = mod.resolverAlcanceNexa("ASESOR", asesorSesion(1), null);
  expect(await mod.getNexaCreditPayments(alcance, 301)).toBeNull();
  expect(await mod.getNexaCreditPayments(alcance, 401)).toBeNull();
  expect(await mod.getNexaCreditPayments(alcance, 999_999)).toBeNull();
  expect(await mod.getNexaCreditPayments(mod.resolverAlcanceNexa("ASESOR", asesorSesion(null), null), 201)).toBeNull();
  const propio = await mod.getNexaCreditPayments(alcance, 201);
  expect(propio?.pagos).toHaveLength(1);
});

integrationTest("detalle: ADMIN ve el detalle de cualquier crédito", async () => {
  const r = await mod.getNexaCreditPayments(mod.resolverAlcanceNexa("ADMIN", null, null), 301);
  expect(r?.pagos.map((p) => p.montoBoleta)).toEqual(["70.00"]);
});

integrationTest("un filtro de asesor inválido se ignora: el ADMIN ve todos", async () => {
  for (const valor of ["1 OR 1=1", "abc", "-1", "0", "1.5", "99999999999", ["1", "2"]]) {
    const r = await mod.getNexaDashboard(mod.resolverAlcanceNexa("ADMIN", null, mod.parseAsesorFiltro(valor)), dash);
    expect(ids(r)).toEqual([201, 202, 301, 401]);
  }
});

integrationTest("sin alcance el controlador no consulta: falla cerrado", async () => {
  // @ts-expect-error: un llamador que olvida el alcance no puede ver todo por defecto.
  await expect(mod.getNexaDashboard(undefined, dash)).rejects.toThrow();
  // @ts-expect-error: idem en el detalle.
  await expect(mod.getNexaCreditPayments(undefined, 201)).rejects.toThrow();
});
