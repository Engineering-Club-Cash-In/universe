import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Ejecuta el SQL real del dashboard Nexa: los mocks no detectan errores de agrupación.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const sinRango = { desde: "", hasta: "" };
const dash = { q: "", page: 1, pageSize: 50, cuotaMes: "" as const, medio: "" as const, ...sinRango };

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
    numero_credito_sifco text, "statusCredit" text, cuota numeric(18,2) NOT NULL DEFAULT 1000)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, numero_cuota integer, credito_id integer, fecha_vencimiento date,
    pagado boolean DEFAULT false)`;
  await sql`CREATE TABLE cartera.bancos (banco_id integer PRIMARY KEY, nombre text)`;
  await sql`INSERT INTO cartera.bancos VALUES (1, 'Banco Industrial'), (2, 'Banrural')`;
  await sql`CREATE TABLE cartera.nexa_credit_bindings (credito_id integer PRIMARY KEY, nexa_token text,
    activo boolean DEFAULT true)`;
  await sql`CREATE TABLE cartera.nexa_payment_events (id serial PRIMARY KEY, credito_id integer NOT NULL,
    external_reference text, amount numeric(18,2) NOT NULL, status text, pago_id integer, error text,
    created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer, cuota_id integer,
    fecha_pago timestamp, monto_boleta numeric(18,2), nexa_payment_event_id integer, registerby text,
    numeroautorizacion text, validation_status text, "paymentFalse" boolean, banco_id integer, monto_aplicado numeric(18,2),
    pagado boolean DEFAULT false)`;
  for (const n of [1, 2, 3, 4, 5]) await sql`INSERT INTO cartera.cuotas_credito VALUES (${n}, ${n})`;
  return { sql, mod: await import("./nexaDashboard") };
})());

let nextCredit = 100;
let nextCuota = 1000;
// Crea un crédito con binding y devuelve helpers para insertar pagos y eventos.
const nuevoCredito = async (cliente?: string) => {
  const { sql, mod } = await setup();
  const id = nextCredit++;
  const sifco = `SIFCO-${id}`;
  await sql`INSERT INTO cartera.usuarios VALUES (${id}, ${cliente ?? `Cliente ${id}`})`;
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
  // Cuota que vence a `desfase` del primer día del mes en curso (hora de Guatemala), p. ej. '-1 month'.
  const cuota = async (numero: number, desfase: string, pagado = false) => {
    const cuotaId = nextCuota++;
    await sql`INSERT INTO cartera.cuotas_credito VALUES (${cuotaId}, ${numero}, ${id},
      (date_trunc('month', now() AT TIME ZONE 'America/Guatemala')::date + ${desfase}::interval)::date, ${pagado})`;
    return cuotaId;
  };
  // Fila de pago aplicada a una cuota; por defecto validada y que la deja pagada (criterio del cron).
  const abono = (cuotaId: number, o: { monto?: number; evento?: number; banco?: number; pagado?: boolean; falso?: boolean; fecha?: string; estado?: string } = {}) =>
    sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, fecha_pago, monto_boleta, monto_aplicado, nexa_payment_event_id,
      registerby, validation_status, "paymentFalse", pagado, banco_id)
      VALUES (${id}, ${cuotaId}, ${o.fecha ?? "2026-09-10 10:00:00"}::timestamp, ${o.monto ?? 100}, ${o.monto ?? 100}, ${o.evento ?? null},
      'cobros@x.com', ${o.estado ?? "validated"}, ${o.falso ?? false}, ${o.pagado ?? true}, ${o.banco ?? null})`;
  return { sql, id, sifco, pago, evento, modal, fila, cuota, abono };
};

integrationTest("fusión: dos boletas manuales idénticas separadas por más de 60 s son 2", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00");
  await c.pago(1, "2026-09-10 10:05:00");
  expect((await c.modal()).pagos).toHaveLength(2);
});

integrationTest("no-partición: una boleta manual en 2 filas a 30 s es 1 con cuotas [3,4]", async () => {
  const c = await nuevoCredito();
  await c.pago(3, "2026-09-10 10:00:00");
  await c.pago(4, "2026-09-10 10:00:30");
  const { pagos } = await c.modal();
  expect(pagos).toHaveLength(1);
  expect(pagos[0]).toMatchObject({ cuotas: [3, 4], filas: 2, canal: "MANUAL" });
});

integrationTest("distinta autorización a 10 s son 2 boletas", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00", { aut: "A1" });
  await c.pago(1, "2026-09-10 10:00:10", { aut: "B2" });
  expect((await c.modal()).pagos).toHaveLength(2);
});

integrationTest("un '|' en quien registró o en la autorización no fusiona dos boletas", async () => {
  const c = await nuevoCredito();
  await c.pago(1, "2026-09-10 10:00:00", { por: "a|b", aut: "c" });
  await c.pago(2, "2026-09-10 10:00:10", { por: "a", aut: "b|c" });
  expect((await c.modal()).pagos).toHaveLength(2);
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
  expect(fila).toMatchObject({ ultimoPagoNexa: true, pagosNexa: 1, montoNexa: "300.00" });
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

integrationTest("pagos-nexa: una boleta Nexa con 3 filas cuenta 1 y suma su monto una vez; sin pagos Nexa da 0", async () => {
  const c = await nuevoCredito();
  const { mod } = await setup();
  expect(await mod.contarPagosNexaCredito(c.id)).toEqual({ cantidad: 0, montoTotal: "0" });
  await c.pago(1, "2026-09-10 10:00:00", { monto: 600 });
  expect(await mod.contarPagosNexaCredito(c.id)).toEqual({ cantidad: 0, montoTotal: "0" });
  const ev1 = await c.evento("applied", 300);
  for (const cuota of [1, 2, 3]) await c.pago(cuota, "2026-09-11 10:00:00", { monto: 300, evento: ev1 });
  const ev2 = await c.evento("applied", 150);
  await c.pago(4, "2026-09-12 10:00:00", { monto: 150, evento: ev2 });
  const ev3 = await c.evento("applied", 80);
  await c.pago(5, "2026-09-13 10:00:00", { monto: 80, evento: ev3, falso: true });
  expect(await mod.contarPagosNexaCredito(c.id)).toEqual({ cantidad: 2, montoTotal: "450.00" });
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

integrationTest("franja por cuota: últimas 12 hasta fin de mes, color por medio, pagada con el criterio del cron", async () => {
  const c = await nuevoCredito();
  await c.cuota(0, "-14 months"); // la cuota 0 no entra
  const ids: number[] = [];
  for (let n = 1; n <= 13; n++) ids.push(await c.cuota(n, `${n - 13} months`)); // la 13 vence este mes
  await c.cuota(14, "1 month"); // la del mes que viene no entra
  const ev = await c.evento("applied", 100);
  await c.abono(ids[12]!, { evento: ev }); // 13: Nexa
  await c.abono(ids[11]!, { banco: 2 }); // 12: manual Banrural
  await c.abono(ids[10]!, { evento: ev, monto: 60 }); // 11: mixta, Nexa puso más
  await c.abono(ids[10]!, { banco: 1, monto: 40, fecha: "2026-09-12 10:00:00" });
  await c.abono(ids[9]!, { evento: ev, monto: 50 }); // 10: empate, gana el pago más reciente (manual)
  await c.abono(ids[9]!, { banco: 1, monto: 50, fecha: "2026-09-12 10:00:00" });
  await c.abono(ids[8]!, { evento: ev, pagado: false }); // 9: abono que no la cubre: no pagada
  await c.abono(ids[7]!, { falso: true }); // 8: pago anulado: no pagada, sin medio
  const { fila } = await c.fila();
  const cuotas = fila!.ultimasCuotas;
  expect(cuotas.map((q) => q.numero)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  expect(cuotas.slice(-6).map(({ numero, pagada, medio, banco }) => ({ numero, pagada, medio, banco }))).toEqual([
    { numero: 8, pagada: false, medio: null, banco: null },
    { numero: 9, pagada: false, medio: "NEXA", banco: null },
    { numero: 10, pagada: true, medio: "MANUAL", banco: "Banco Industrial" },
    { numero: 11, pagada: true, medio: "NEXA", banco: null },
    { numero: 12, pagada: true, medio: "MANUAL", banco: "Banrural" },
    { numero: 13, pagada: true, medio: "NEXA", banco: null },
  ]);
  expect(cuotas[0]!.vencimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(fila!.cuotaMes).toMatchObject({ numero: 13, estado: "pagada" });
});

integrationTest("cuota del mes: pagados y pendientes (vencida y por vencer); el filtro pagina y cuenta con eso", async () => {
  const prefijo = `CuotaMes-${Date.now()}`;
  // A: la cuota de este mes, pagada.
  const a = await nuevoCredito(`${prefijo} A`);
  await a.abono(await a.cuota(1, "0 days"));
  // B: sin cuota este mes; la última vencida (mes pasado) sin pagar → pendiente, vencida.
  const b = await nuevoCredito(`${prefijo} B`);
  await b.cuota(1, "-1 month");
  // C: vence el último día de este mes, sin pagar → pendiente, por vencer.
  const c = await nuevoCredito(`${prefijo} C`);
  await c.cuota(1, "1 month -1 day");
  // D: dos cuotas este mes (plazo de 30 días): cuenta la primera, que está pagada.
  const d = await nuevoCredito(`${prefijo} D`);
  await d.abono(await d.cuota(1, "0 days"));
  await d.cuota(2, "1 month -1 day");
  // E: sin cuotas → no entra en ningún filtro de cuota.
  await nuevoCredito(`${prefijo} E`);
  const { mod } = await setup();
  const ver = async (cuotaMes: "" | "pagados" | "pendientes", pageSize = 50) => {
    const r = await mod.getNexaDashboard({ ...dash, q: prefijo, cuotaMes, pageSize });
    return { r, clientes: r.creditos.map((x) => x.cliente.slice(-1)).sort() };
  };
  const todos = await ver("");
  expect(todos.clientes).toEqual(["A", "B", "C", "D", "E"]);
  const de = (l: string) => todos.r.creditos.find((x) => x.cliente.endsWith(l))!.cuotaMes;
  expect(de("A")).toMatchObject({ numero: 1, estado: "pagada", pago: "completa", aplicado: "100.00", monto: "1000.00", medio: "MANUAL" });
  expect(de("B")).toMatchObject({ numero: 1, estado: "vencida", pago: "sin_pago", aplicado: "0.00", monto: "1000.00", medio: null });
  expect(de("B")!.vencimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(de("C")).toMatchObject({ estado: "por_vencer", pago: "sin_pago" });
  expect(de("E")).toBeNull();
  expect((await ver("pagados")).clientes).toEqual(["A", "D"]);
  const pendientes = await ver("pendientes");
  expect(pendientes.clientes).toEqual(["B", "C"]);
  // La etiqueta sigue distinguiendo vencida de por vencer.
  expect(pendientes.r.creditos.map((x) => x.cuotaMes!.estado).sort()).toEqual(["por_vencer", "vencida"]);
  const pag = await ver("pagados", 1);
  expect(pag.r.creditos).toHaveLength(1);
  expect(pag.r.total).toBe(2);
  expect(pag.r.totales.creditos).toBe(2);
});

integrationTest("pagados por Nexa o manual: el medio de la cuota del mes (gana el que más aplicó), no el del último pago", async () => {
  const prefijo = `Medio-${Date.now()}`;
  // N: cuota del mes pagada por Nexa, pero el último pago del crédito fue manual (a otra cuota).
  const n = await nuevoCredito(`${prefijo} N`);
  const ev = await n.evento("applied", 100);
  await n.abono(await n.cuota(2, "0 days"), { evento: ev, fecha: "2026-09-10 10:00:00" });
  await n.pago(1, "2026-09-20 10:00:00", { monto: 30 });
  // M: cuota del mes mixta, el manual aplicó más; el último pago fue Nexa.
  const m = await nuevoCredito(`${prefijo} M`);
  const qm = await m.cuota(1, "0 days");
  const evm = await m.evento("applied", 40);
  await m.abono(qm, { banco: 1, monto: 60, fecha: "2026-09-01 10:00:00" });
  await m.abono(qm, { evento: evm, monto: 40, fecha: "2026-09-12 10:00:00" });
  // F: pagada solo por el flag, sin filas: "sin detalle del medio", la franja la pinta verde → manual.
  const f = await nuevoCredito(`${prefijo} F`);
  await f.cuota(1, "0 days", true);
  // P: pendiente con un abono Nexa: no entra en pagados por Nexa.
  const pe = await nuevoCredito(`${prefijo} P`);
  const evp = await pe.evento("applied", 40);
  await pe.abono(await pe.cuota(1, "1 month -1 day"), { evento: evp, monto: 40, pagado: false });
  const { mod } = await setup();
  const ver = async (cuotaMes: "" | "pagados" | "pendientes", medio: "" | "nexa" | "manual") =>
    (await mod.getNexaDashboard({ ...dash, q: prefijo, cuotaMes, medio })).creditos.map((x) => x.cliente.slice(-1)).sort();
  expect(await ver("pagados", "")).toEqual(["F", "M", "N"]);
  expect(await ver("pagados", "nexa")).toEqual(["N"]);
  expect(await ver("pagados", "manual")).toEqual(["F", "M"]);
  // Sin "pagados", el medio no filtra.
  expect(await ver("pendientes", "nexa")).toEqual(["P"]);
  expect(await ver("", "nexa")).toEqual(["F", "M", "N", "P"]);
  const r = await mod.getNexaDashboard({ ...dash, q: prefijo, cuotaMes: "pagados", medio: "manual" });
  expect(r.totales.creditos).toBe(2);
  const fm = r.creditos.find((x) => x.cliente.endsWith("M"))!;
  expect(fm).toMatchObject({ ultimoPagoNexa: true });
  expect(fm.cuotaMes).toMatchObject({ pago: "completa", aplicado: "100.00", medio: "MANUAL" });
  expect(r.creditos.find((x) => x.cliente.endsWith("F"))!.cuotaMes).toMatchObject({ pago: "completa", aplicado: "0.00", medio: null });
  const fn = (await n.fila()).fila!;
  expect(fn).toMatchObject({ ultimoPagoNexa: false });
  expect(fn.cuotaMes).toMatchObject({ estado: "pagada", pago: "completa", medio: "NEXA" });
});

integrationTest("parcial: suma lo aplicado sin anuladas ni 'reset', contra la cuota del crédito; en pendientes van primero", async () => {
  const prefijo = `Parcial-${Date.now()}`;
  // S: pendiente sin pago, con un último pago más reciente que el de P (sin el orden, iría primero).
  const sp = await nuevoCredito(`${prefijo} S`);
  await sp.cuota(1, "-1 month");
  await sp.pago(1, "2026-09-25 10:00:00", { monto: 5 });
  // P: cuota de Q2,500 vencida con 300 + 200 aplicados; una anulada (999) y una 'reset' (777) no cuentan.
  const p = await nuevoCredito(`${prefijo} P`);
  await p.sql`UPDATE cartera.creditos SET cuota = 2500 WHERE credito_id = ${p.id}`;
  const q = await p.cuota(1, "-1 month");
  const ev = await p.evento("applied", 300);
  await p.abono(q, { evento: ev, monto: 300, pagado: false, fecha: "2026-09-01 10:00:00" });
  await p.abono(q, { banco: 2, monto: 200, pagado: false, fecha: "2026-09-02 10:00:00" });
  await p.abono(q, { monto: 999, falso: true });
  await p.abono(q, { monto: 777, estado: "reset", pagado: false });
  const { mod } = await setup();
  const r = await mod.getNexaDashboard({ ...dash, q: prefijo, cuotaMes: "pendientes" });
  expect(r.creditos.map((x) => x.cliente.slice(-1))).toEqual(["P", "S"]);
  expect(r.creditos[0]!.cuotaMes).toMatchObject({ estado: "vencida", pago: "parcial", aplicado: "500.00", monto: "2500.00", medio: "NEXA" });
  expect(r.creditos[0]!.ultimasCuotas).toEqual([
    { numero: 1, vencimiento: expect.any(String), pagada: false, medio: "NEXA", banco: null, aplicado: "500.00", monto: "2500.00" },
  ]);
  expect(r.creditos[1]!.cuotaMes).toMatchObject({ pago: "sin_pago", aplicado: "0.00" });
  // Sin el filtro de pendientes, el orden es el de siempre (último pago más reciente primero).
  const todos = await mod.getNexaDashboard({ ...dash, q: prefijo });
  expect(todos.creditos.map((x) => x.cliente.slice(-1))).toEqual(["S", "P"]);
});

integrationTest("detalle de rechazos: fecha, monto, código y estado; manual_review con filas vivas no aparece", async () => {
  const c = await nuevoCredito();
  const viejo = await c.evento("failed", 70);
  await c.sql`UPDATE cartera.nexa_payment_events SET error = 'token_mismatch', created_at = '2026-09-15 18:00:00+00' WHERE id = ${viejo}`;
  const revision = await c.evento("manual_review", 55);
  await c.sql`UPDATE cartera.nexa_payment_events SET error = 'payment_outcome_uncertain', created_at = '2026-09-20 18:00:00+00' WHERE id = ${revision}`;
  const vivo = await c.evento("manual_review", 90);
  await c.pago(1, "2026-09-21 10:00:00", { monto: 90, evento: vivo });
  // failed con fila pending de otra fecha: el detalle muestra cuándo llegó, como el modal.
  const colgado = await c.evento("failed", 130);
  await c.sql`UPDATE cartera.nexa_payment_events SET error = 'payment_not_applied', created_at = '2026-10-03 18:00:00+00' WHERE id = ${colgado}`;
  await c.pago(2, "2026-09-28 10:00:00", { monto: 130, evento: colgado, estado: "pending" });
  const { fila } = await c.fila();
  expect(fila!.rechazosNexa).toBe(3);
  expect(fila!.rechazosDetalle).toEqual([
    { fecha: "2026-10-03T12:00:00", monto: "130.00", codigo: "payment_not_applied", estado: "failed" },
    { fecha: "2026-09-20T12:00:00", monto: "55.00", codigo: "payment_outcome_uncertain", estado: "manual_review" },
    { fecha: "2026-09-15T12:00:00", monto: "70.00", codigo: "token_mismatch", estado: "failed" },
  ]);
});

integrationTest("los filtros llegan como parámetros: un valor fuera de la lista no filtra ni rompe el SQL", async () => {
  const { mod } = await setup();
  const params = mod.parseNexaDashboardParams({ medio: "nexa' OR 1=1 --", cuotaMes: "pagados; drop table x" });
  expect({ medio: params.medio, cuotaMes: params.cuotaMes }).toEqual({ medio: "", cuotaMes: "" });
  const c = await nuevoCredito();
  expect((await mod.getNexaDashboard({ ...params, q: c.sifco })).creditos).toHaveLength(1);
});

integrationTest("pagada = criterio del cron: cuotas_credito.pagado sin fila que la cubra cuenta como pagada", async () => {
  const c = await nuevoCredito();
  // Caso real (crédito 553, cuota 38): pagado = true y una sola fila de 0.00 con pagado = false.
  const vieja = await c.cuota(1, "-1 month", true);
  await c.abono(vieja, { monto: 0, pagado: false });
  // Pagada por el flag, con una fila manual que no la cubre: el medio sale de esa fila (respaldo).
  const conAbono = await c.cuota(2, "0 days", true);
  await c.abono(conAbono, { banco: 2, pagado: false, estado: "pending", fecha: "2020-01-01 10:00:00" });
  const { fila } = await c.fila();
  expect(fila!.ultimasCuotas.map(({ numero, pagada, medio, banco }) => ({ numero, pagada, medio, banco }))).toEqual([
    { numero: 1, pagada: true, medio: null, banco: null },
    { numero: 2, pagada: true, medio: "MANUAL", banco: "Banrural" },
  ]);
  expect(fila!.cuotaMes).toMatchObject({ numero: 2, estado: "pagada" });
});

integrationTest("medio: solo cuentan las filas que cubren la cuota; una fila manual 'reset' no la pinta de verde", async () => {
  const c = await nuevoCredito();
  const ev = await c.evento("applied", 100);
  const q = await c.cuota(1, "0 days");
  await c.abono(q, { evento: ev, monto: 100 });
  await c.abono(q, { banco: 1, monto: 900, estado: "reset", fecha: "2026-09-12 10:00:00" });
  await c.abono(q, { banco: 1, monto: 800, estado: "capital_validated", fecha: "2026-09-13 10:00:00" });
  const { fila } = await c.fila();
  expect(fila!.ultimasCuotas).toEqual([
    // aplicado: sin la fila 'reset' (100 Nexa + 800 manual), aunque el medio salga solo de la que cubre.
    { numero: 1, vencimiento: expect.any(String), pagada: true, medio: "NEXA", banco: null, aplicado: "900.00", monto: "1000.00" },
  ]);
});

integrationTest("rechazos: tope de 5, ordenados por cuándo llegaron (no por id), y el total cuenta todos", async () => {
  const c = await nuevoCredito();
  // Ids crecientes con fechas desordenadas: el primero insertado es el más reciente.
  const dias = ["2026-09-30", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
  for (const [i, dia] of dias.entries()) {
    const ev = await c.evento("failed", 10 + i);
    await c.sql`UPDATE cartera.nexa_payment_events SET error = 'token_mismatch', created_at = ${`${dia} 18:00:00+00`}::timestamptz WHERE id = ${ev}`;
  }
  const { fila } = await c.fila();
  expect(fila!.rechazosNexa).toBe(6);
  expect(fila!.rechazosDetalle.map((r) => r.fecha!.slice(0, 10))).toEqual(["2026-09-30", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02"]);
});
