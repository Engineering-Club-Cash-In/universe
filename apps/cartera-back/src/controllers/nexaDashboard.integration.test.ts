import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Ejecuta el SQL real del dashboard Nexa: los mocks no detectan errores de agrupación.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const sinRango = { desde: "", hasta: "" };
const dash = { q: "", page: 1, pageSize: 50, ...sinRango };

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{ sql: Sql; mod: typeof import("./nexaDashboard") }> | undefined;
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  const sql = postgres(testDatabaseUrl!, { ssl: false });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.usuarios (usuario_id integer PRIMARY KEY, nombre text)`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, usuario_id integer,
    numero_credito_sifco text, "statusCredit" text)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, numero_cuota integer)`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (credito_id integer PRIMARY KEY, nexa_token text,
    activo boolean DEFAULT true)`;
  await sql`CREATE TABLE cartera.nexa_payment_events (id serial PRIMARY KEY, credito_id integer NOT NULL,
    external_reference text, amount numeric(18,2) NOT NULL, status text, pago_id integer, error text,
    created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer, cuota_id integer,
    fecha_pago timestamp, monto_boleta numeric(18,2), nexa_payment_event_id integer, registerby text,
    numeroautorizacion text, validation_status text, "paymentFalse" boolean)`;
  for (const n of [1, 2, 3, 4, 5]) await sql`INSERT INTO cartera.cuotas_credito VALUES (${n}, ${n})`;
  return { sql, mod: await import("./nexaDashboard") };
})());

let nextCredit = 100;
// Crea un crédito con binding y devuelve helpers para insertar pagos y eventos.
const nuevoCredito = async () => {
  const { sql, mod } = await setup();
  const id = nextCredit++;
  const sifco = `SIFCO-${id}`;
  await sql`INSERT INTO cartera.usuarios VALUES (${id}, ${`Cliente ${id}`})`;
  await sql`INSERT INTO cartera.creditos VALUES (${id}, ${id}, ${sifco}, 'ACTIVO')`;
  await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id}, ${`tok${id}`}, true)`;
  const pago = (cuota: number, fecha: string, o: { monto?: number; por?: string; aut?: string; evento?: number; falso?: boolean; estado?: string } = {}) =>
    sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, nexa_payment_event_id,
      registerby, numeroautorizacion, validation_status, "paymentFalse")
      VALUES (${id}, ${cuota}, ${fecha}::timestamp, ${o.monto ?? 100}, ${o.evento ?? null}, ${o.por ?? "cobros@x.com"},
      ${o.aut ?? "A1"}, ${o.estado ?? "validated"}, ${o.falso ?? false})`;
  const evento = async (status: string, monto = 100) => {
    const [e] = await sql`INSERT INTO cartera.nexa_payment_events (credito_id, external_reference, amount, status)
      VALUES (${id}, ${`ref-${id}-${Math.random()}`}, ${monto}, ${status}) RETURNING id`;
    return e!.id as number;
  };
  const modal = (rango = sinRango) => mod.getNexaCreditPayments(id, rango);
  const fila = async (rango = sinRango) => {
    const r = await mod.getNexaDashboard({ ...dash, ...rango, q: sifco });
    return { r, fila: r.creditos[0] };
  };
  return { sql, id, pago, evento, modal, fila };
};

integrationTest("fusión: dos boletas manuales idénticas separadas por más de 60 s son 2", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00");
  await c.pago(1, "2026-09-10 10:05:00");
  expect((await c.modal()).pagos).toHaveLength(2);
  expect((await c.fila()).fila!.ultimosCanales).toBe("MM");
});

integrationTest("no-partición: una boleta manual en 2 filas a 30 s es 1 con cuotas [3,4]", async () => {
  const c = await nuevoCredito();
  await c.pago(3, "2026-09-10 10:00:00");
  await c.pago(4, "2026-09-10 10:00:30");
  const { pagos } = await c.modal();
  expect(pagos).toHaveLength(1);
  expect(pagos[0]).toMatchObject({ cuotas: [3, 4], filas: 2, canal: "MANUAL" });
  expect((await c.fila()).fila!.ultimosCanales).toBe("M");
});

integrationTest("distinta autorización a 10 s son 2 boletas", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00", { aut: "A1" });
  await c.pago(1, "2026-09-10 10:00:10", { aut: "B2" });
  expect((await c.modal()).pagos).toHaveLength(2);
  expect((await c.fila()).fila!.ultimosCanales).toBe("MM");
});

integrationTest("un '|' en quien registró o en la autorización no fusiona dos boletas", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00", { por: "a|b", aut: "c" });
  await c.pago(2, "2026-09-10 10:00:10", { por: "a", aut: "b|c" });
  expect((await c.modal()).pagos).toHaveLength(2);
  expect((await c.fila()).fila!.ultimosCanales).toBe("MM");
});

integrationTest("fecha futura no aparece ni cuenta como último pago", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00", { monto: 50 });
  await c.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, registerby)
    VALUES (${c.id}, 2, (now() AT TIME ZONE 'America/Guatemala') + interval '1 day', 999, 'x')`;
  const { pagos } = await c.modal();
  expect(pagos.map((p) => p.montoBoleta)).toEqual(["50.00"]);
  const { fila } = await c.fila();
  expect(fila!.ultimoPagoMonto).toBe("50.00");
  expect(fila!.ultimoPagoFecha).toBe("2026-09-10T10:00:00");
});

integrationTest("Nexa revertido (paymentFalse) no cuenta en pagos ni monto Nexa", async () => {
  const c = await nuevoCredito();
  const ev = await c.evento("applied", 200);
  await c.pago(1, "2026-09-10 10:00:00", { monto: 200, evento: ev, falso: true });
  await c.sql`UPDATE cartera.nexa_payment_events SET pago_id = (SELECT pago_id FROM cartera.pagos_credito WHERE nexa_payment_event_id = ${ev}) WHERE id = ${ev}`;
  const { r, fila } = await c.fila();
  expect(fila).toMatchObject({ pagosNexa: 0, montoNexa: "0", ultimoPagoNexa: false, ultimoPagoFecha: null });
  expect(r.totales).toMatchObject({ pagosNexa: 0, montoNexa: "0", ultimoPagoNexa: 0 });
  expect((await c.modal()).pagos).toHaveLength(0);
});

integrationTest("boleta Nexa en 3 filas es 1, canal NEXA y último pago Nexa", async () => {
  const c = await nuevoCredito();
  const ev = await c.evento("applied", 300);
  await c.pago(1, "2026-09-10 10:00:00", { monto: 300, evento: ev, por: "", aut: "" });
  await c.pago(2, "2026-09-10 10:30:00", { monto: 300, evento: ev, por: "", aut: "" });
  await c.pago(3, "2026-09-10 11:00:00", { monto: 300, evento: ev, por: "", aut: "" });
  await c.sql`UPDATE cartera.nexa_payment_events SET pago_id = (SELECT MIN(pago_id) FROM cartera.pagos_credito WHERE nexa_payment_event_id = ${ev}) WHERE id = ${ev}`;
  const { pagos } = await c.modal();
  expect(pagos).toHaveLength(1);
  expect(pagos[0]).toMatchObject({ canal: "NEXA", filas: 3, cuotas: [1, 2, 3], eventoEstado: "applied" });
  const { r, fila } = await c.fila();
  expect(fila).toMatchObject({ ultimoPagoNexa: true, pagosNexa: 1, montoNexa: "300.00", ultimosCanales: "N" });
  expect(r.totales.ultimoPagoNexa).toBe(1);
});

integrationTest("eventos sin pago: failed aparece, applied con pago no", async () => {
  const c = await nuevoCredito();
  await c.evento("failed", 70);
  const ok = await c.evento("applied", 80);
  await c.pago(1, "2026-09-10 10:00:00", { monto: 80, evento: ok });
  await c.sql`UPDATE cartera.nexa_payment_events SET pago_id = (SELECT pago_id FROM cartera.pagos_credito WHERE nexa_payment_event_id = ${ok}) WHERE id = ${ok}`;
  const { eventosSinPago } = await c.modal();
  expect(eventosSinPago).toHaveLength(1);
  expect(eventosSinPago[0]).toMatchObject({ estado: "failed", monto: "70.00" });
  expect((await c.fila()).fila!.rechazosNexa).toBe(1);
});

integrationTest("manual_review con filas de pago vivas no es 'pago sin aplicar' ni cuenta como rechazo; sin filas sí", async () => {
  const c = await nuevoCredito();
  const aplicado = await c.evento("manual_review", 90);
  await c.pago(1, "2026-09-10 10:00:00", { monto: 90, evento: aplicado });
  const pendiente = await c.evento("manual_review", 55);
  const { eventosSinPago } = await c.modal();
  expect(eventosSinPago).toHaveLength(1);
  expect(eventosSinPago[0]).toMatchObject({ estado: "manual_review", monto: "55.00", tieneFilasVivas: false });
  expect((await c.fila()).fila!.rechazosNexa).toBe(1);
  expect(pendiente).not.toBe(aplicado);
});

integrationTest("failed con fila pending viva cuenta como rechazo y el modal la marca para anular", async () => {
  const c = await nuevoCredito();
  const ev = await c.evento("failed", 120);
  await c.pago(1, "2026-09-10 10:00:00", { monto: 120, evento: ev, estado: "pending" });
  const { eventosSinPago } = await c.modal();
  expect(eventosSinPago).toHaveLength(1);
  expect(eventosSinPago[0]).toMatchObject({ estado: "failed", monto: "120.00", tieneFilasVivas: true });
  const { r, fila } = await c.fila();
  expect(fila!.rechazosNexa).toBe(1);
  expect(r.totales.rechazosNexa).toBe(1);
});

integrationTest("filtro de rango: failed que llegó fuera del rango con fila pending dentro: tabla y modal coinciden", async () => {
  const c = await nuevoCredito();
  const ev = await c.evento("failed", 130);
  await c.sql`UPDATE cartera.nexa_payment_events SET created_at = '2026-10-03 18:00:00+00' WHERE id = ${ev}`;
  await c.pago(1, "2026-09-28 10:00:00", { monto: 130, evento: ev, estado: "pending" });
  const rango = { desde: "2026-09-01", hasta: "2026-09-30" };
  expect((await c.fila(rango)).fila!.rechazosNexa).toBe(1);
  const { eventosSinPago } = await c.modal(rango);
  expect(eventosSinPago).toHaveLength(1);
  expect(eventosSinPago[0]).toMatchObject({ estado: "failed", monto: "130.00", tieneFilasVivas: true });
  // Y en el rango de cuando llegó, ninguno de los dos lo cuenta.
  const octubre = { desde: "2026-10-01", hasta: "2026-10-31" };
  expect((await c.modal(octubre)).eventosSinPago).toHaveLength(0);
  expect((await c.fila(octubre)).r.creditos).toHaveLength(0);
});

integrationTest("filtro de rango: un pago fuera del rango no aparece", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-08-05 10:00:00", { monto: 11 });
  await c.pago(2, "2026-09-10 10:00:00", { monto: 22 });
  const rango = { desde: "2026-09-01", hasta: "2026-09-30" };
  expect((await c.modal(rango)).pagos.map((p) => p.montoBoleta)).toEqual(["22.00"]);
  expect((await c.fila(rango)).fila!.ultimoPagoMonto).toBe("22.00");
  const fuera = await c.fila({ desde: "2026-01-01", hasta: "2026-01-31" });
  expect(fuera.r.creditos).toHaveLength(0);
});

integrationTest("filtro de rango: un crédito con solo pagos rechazados en el período sigue apareciendo", async () => {
  const c = await nuevoCredito();
  const ev = await c.evento("failed", 70);
  await c.sql`UPDATE cartera.nexa_payment_events SET created_at = '2026-09-15 18:00:00+00' WHERE id = ${ev}`;
  const dentro = await c.fila({ desde: "2026-09-01", hasta: "2026-09-30" });
  expect(dentro.r.creditos).toHaveLength(1);
  expect(dentro.fila).toMatchObject({ rechazosNexa: 1, pagosNexa: 0, ultimoPagoFecha: null });
  const fuera = await c.fila({ desde: "2026-01-01", hasta: "2026-01-31" });
  expect(fuera.r.creditos).toHaveLength(0);
});

integrationTest("límite de futuro: manual en hora de Guatemala cae en su día y se muestra tal cual", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-30 17:33:41");
  const rango = { desde: "2026-09-30", hasta: "2026-09-30" };
  const { pagos } = await c.modal(rango);
  expect(pagos).toHaveLength(1);
  expect((await c.fila(rango)).fila!.ultimoPagoFecha).toBe("2026-09-30T17:33:41");
  expect((await c.modal({ desde: "2026-09-29", hasta: "2026-09-29" })).pagos).toHaveLength(0);
});

integrationTest("límite de futuro: fecha sin hora (00:00) queda en su día, no en el anterior", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-30 00:00:00");
  expect((await c.modal({ desde: "2026-09-30", hasta: "2026-09-30" })).pagos).toHaveLength(1);
  expect((await c.modal({ desde: "2026-09-29", hasta: "2026-09-29" })).pagos).toHaveLength(0);
});

integrationTest("límite de futuro: fila con la hora UTC del servidor (default now()) aparece", async () => {
  const c = await nuevoCredito();
  await c.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, registerby)
    VALUES (${c.id}, 1, (now() AT TIME ZONE 'UTC') - interval '1 minute', 77, 'x')`;
  expect((await c.modal()).pagos.map((p) => p.montoBoleta)).toEqual(["77.00"]);
});

integrationTest("límite de futuro: fila con años de adelanto (SIFCO) no aparece", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00", { monto: 50 });
  await c.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, registerby)
    VALUES (${c.id}, 2, '2030-01-01 00:00:00', 999, 'x')`;
  expect((await c.modal()).pagos.map((p) => p.montoBoleta)).toEqual(["50.00"]);
});

integrationTest("página más allá del final: creditos vacío pero total y totales siguen", async () => {
  const { sql, mod } = await setup();
  const ids = [nextCredit++, nextCredit++, nextCredit++];
  for (const [i, id] of ids.entries()) {
    await sql`INSERT INTO cartera.usuarios VALUES (${id}, ${`Paginado ${id}`})`;
    await sql`INSERT INTO cartera.creditos VALUES (${id}, ${id}, ${`SIFCO-${id}`}, 'ACTIVO')`;
    // El último sin token.
    await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id}, ${i < 2 ? `tok${id}` : null}, true)`;
    const [e] = await sql`INSERT INTO cartera.nexa_payment_events (credito_id, external_reference, amount, status)
      VALUES (${id}, ${`ref-pag-${id}`}, 40, 'applied') RETURNING id`;
    await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, nexa_payment_event_id, validation_status)
      VALUES (${id}, 1, '2026-09-10 10:00:00', 40, ${e!.id}, 'validated')`;
    await sql`UPDATE cartera.nexa_payment_events SET pago_id = (SELECT pago_id FROM cartera.pagos_credito WHERE nexa_payment_event_id = ${e!.id}) WHERE id = ${e!.id}`;
  }
  const totales = { creditos: 3, conToken: 2, pagosNexa: 3, montoNexa: "120.00", rechazosNexa: 0, ultimoPagoNexa: 3 };

  const ultima = await mod.getNexaDashboard({ ...dash, q: "Paginado", page: 2, pageSize: 2 });
  expect(ultima.creditos).toHaveLength(1);
  expect(ultima.total).toBe(3);

  const fuera = await mod.getNexaDashboard({ ...dash, q: "Paginado", page: 3, pageSize: 2 });
  expect(fuera.creditos).toEqual([]);
  expect(fuera.total).toBe(3);
  expect(fuera.totales).toEqual(totales);
  expect({ page: fuera.page, pageSize: fuera.pageSize }).toEqual({ page: 3, pageSize: 2 });

  const nada = await mod.getNexaDashboard({ ...dash, q: "no-existe-nadie" });
  expect(nada).toMatchObject({ creditos: [], total: 0 });
  expect(nada.totales).toEqual({ creditos: 0, conToken: 0, pagosNexa: 0, montoNexa: "0", rechazosNexa: 0, ultimoPagoNexa: 0 });
});
