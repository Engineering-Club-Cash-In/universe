import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Postgres real: el cierre de las 5 pm de Contabilidad en la pantalla "Pagos con
// Inversionistas". Corre el getPagosConInversionistas real, con su SQL completo.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{ sql: Sql; mod: typeof import("./payments") }> | undefined;
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  // Solo las columnas que lee la consulta del reporte.
  await sql.unsafe(`
    CREATE TABLE cartera.usuarios (usuario_id integer PRIMARY KEY, nombre text, nit text, categoria text);
    CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY, usuario_id integer, asesor_id integer,
      numero_credito_sifco text, capital numeric, deudatotal numeric, "statusCredit" text, porcentaje_interes numeric,
      fecha_creacion timestamp, bandera_reinversion boolean DEFAULT false, tipo_credito text, formato_credito text);
    CREATE TABLE cartera.bancos (banco_id integer PRIMARY KEY, nombre text);
    CREATE TABLE cartera.cuentas_empresa (cuenta_id integer PRIMARY KEY, nombre_cuenta text, banco text, numero_cuenta text);
    CREATE TABLE cartera.asesores (asesor_id integer PRIMARY KEY, nombre text);
    CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, numero_cuota integer, fecha_vencimiento date);
    CREATE TABLE cartera.nexa_payment_events (id serial PRIMARY KEY, status text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE cartera.pagos_credito (pago_id integer PRIMARY KEY, credito_id integer, cuota_id integer,
      monto_boleta numeric, numeroautorizacion text, fecha_pago timestamp, mora numeric, pago_convenio numeric,
      otros numeric, reserva numeric, membresias_pago numeric, observaciones text, registerby text, banco_id integer,
      cuenta_empresa_id integer, fecha_boleta date, fecha_aplicado timestamp, cuota numeric, pagado boolean,
      abono_capital numeric, abono_interes numeric DEFAULT 0, abono_iva_12 numeric, abono_seguro numeric,
      abono_gps numeric, validation_status text, monto_aplicado numeric, origen_pago text,
      nexa_payment_event_id integer, createdat timestamp DEFAULT now());
    CREATE TABLE cartera.inversionistas (inversionista_id integer PRIMARY KEY, nombre text, emite_factura boolean);
    CREATE TABLE cartera.pagos_credito_inversionistas (pago_id integer, credito_id integer, inversionista_id integer,
      abono_capital numeric, abono_interes numeric, abono_iva_12 numeric, cuota numeric);
    CREATE TABLE cartera.pagos_credito_inversionistas_facturado (pago_id integer, inversionista_id integer,
      abono_interes numeric, abono_iva_12 numeric, monto_aportado numeric, porcentaje_participacion numeric,
      redirigido_a_cube boolean);
    CREATE TABLE cartera.creditos_inversionistas (credito_id integer, inversionista_id integer, monto_aportado numeric,
      porcentaje_participacion_inversionista numeric, porcentaje_cash_in numeric);
    CREATE TABLE cartera.creditos_inversionistas_espejo (credito_id integer, inversionista_id integer, status text);
    CREATE TABLE cartera.compras_credito_inversionista (credito_id integer, pendiente_facturar boolean, tipo_operacion text);
    CREATE TABLE cartera.facturacion_desglose (pago_id integer, rubro text, monto_total numeric, monto_iva numeric);
    CREATE TABLE cartera.boletas (id serial PRIMARY KEY, pago_id integer, url_boleta text);
    CREATE TABLE cartera.credit_cancelations (id serial PRIMARY KEY, credit_id integer, motivo text, observaciones text,
      fecha_cancelacion timestamp, monto_cancelacion numeric, activo boolean, traspaso numeric,
      garantia_mobiliaria numeric, otros numeric, cuotas_atrasadas integer);
    CREATE TABLE cartera.montos_adicionales (credit_id integer, concepto text, monto numeric);
    INSERT INTO cartera.usuarios VALUES (1, 'Cliente', '123', 'A');
    INSERT INTO cartera.creditos (credito_id, usuario_id, numero_credito_sifco, "statusCredit") VALUES (1, 1, 'S-1', 'ACTIVO');
    -- created_at = cuando cartera recibió el pago Nexa (la hora real de registro).
    INSERT INTO cartera.nexa_payment_events (id, status, created_at) VALUES
      (1, 'applied', '2026-10-07 00:12:35+00'),  -- 06-oct 18:12 GT
      (2, 'applied', '2026-10-06 15:00:00+00'),  -- 06-oct 09:00 GT
      (3, 'failed',  '2026-10-06 16:00:00+00');  -- 06-oct 10:00 GT
  `);
  // fecha_pago: manual = hora de Guatemala; Nexa = día bancario a las 00:00.
  // createdat de los Nexa = la fila VIEJA de la cuota que registerPayment reusa
  // al cerrarla (.set({...pagoData}) conserva su createdat de meses atrás), como
  // los pagos 117332 y 17768 del dump de producción. No sirve para la hora.
  const pagos: [number, string | null, number | null, string][] = [
    [1, "2026-10-06 16:59:00", null, "2026-10-06 22:59:00"], // manual 16:59 GT → cierre actual
    [2, "2026-10-06 17:00:00", null, "2026-10-06 23:00:00"], // manual 17:00 en punto → cierre siguiente
    [3, "2026-10-05 17:00:00", null, "2026-10-05 23:00:00"], // manual 17:00 del día anterior → cierre actual
    [4, "2026-10-05 16:59:00", null, "2026-10-05 22:59:00"], // manual → cierre anterior
    [5, "2026-10-06 00:00:00", 1, "2026-03-30 14:20:00"],    // Nexa (fila reusada), entró 18:12 GT → cierre siguiente
    [6, "2026-10-06 00:00:00", 2, "2026-01-18 10:00:00"],    // Nexa (fila reusada), entró 09:00 GT → cierre actual
    [7, null, null, "2026-10-06 20:00:00"],                  // manual viejo sin fecha_pago → fuera del filtro con hora
    [8, "2026-10-06 00:00:00", 3, "2026-02-01 12:00:00"],    // Nexa rechazado, 10:00 GT → cierre actual
  ];
  for (const [id, fecha, evento, creado] of pagos) {
    await sql`INSERT INTO cartera.pagos_credito (pago_id, credito_id, fecha_pago, nexa_payment_event_id, createdat,
      validation_status, monto_aplicado, monto_boleta, pago_convenio)
      VALUES (${id}, 1, ${fecha}::timestamp, ${evento}, ${creado}::timestamp, 'validated', 100, 100, 0)`;
  }
  return { sql, mod: await import("./payments") };
})());

const ids = async (opciones: Record<string, string>) => {
  const { mod } = await setup();
  const r: any = await mod.getPagosConInversionistas({ pageSize: 100, ...opciones });
  expect(r.success).toBe(true);
  return (r.data as any[]).map((p) => Number(p.pagoId)).sort((a, b) => a - b);
};
const cierre = { fechaInicio: "2026-10-05", horaInicio: "17:00", fechaFin: "2026-10-06", horaFin: "17:00" };

integrationTest("cierre 17:00→17:00: manual 16:59 entra, 17:00 en punto pasa al siguiente", async () => {
  expect(await ids(cierre)).toEqual([1, 3, 6, 8]);
});

integrationTest("Nexa en fila reusada: manda la hora del evento (18:12 GT → cierre siguiente), no createdat", async () => {
  expect(await ids({ fechaInicio: "2026-10-06", horaInicio: "17:00", fechaFin: "2026-10-07", horaFin: "17:00" }))
    .toEqual([2, 5]);
});

integrationTest("canal dentro del cierre: Nexa vs manual, y la etiqueta del rechazado", async () => {
  expect(await ids({ ...cierre, canal: "NEXA" })).toEqual([6, 8]);
  expect(await ids({ ...cierre, canal: "MANUAL" })).toEqual([1, 3]);
  const { mod } = await setup();
  const r: any = await mod.getPagosConInversionistas({ ...cierre, canal: "NEXA" });
  const porId = new Map((r.data as any[]).map((p) => [Number(p.pagoId), p]));
  expect(porId.get(6)).toMatchObject({ entroPorNexa: true, nexaEventoFallido: false });
  expect(porId.get(8)).toMatchObject({ entroPorNexa: true, nexaEventoFallido: true });
});

integrationTest("una sola hora: la otra punta usa 00:00 al inicio y fin de día al final", async () => {
  // Hasta 2026-10-06 sin hora = hasta el fin de ese día: entran el 2 (17:00) y el Nexa 5 (18:12 GT).
  expect(await ids({ fechaInicio: "2026-10-05", horaInicio: "17:00", fechaFin: "2026-10-06" })).toEqual([1, 2, 3, 5, 6, 8]);
  // Desde 2026-10-06 sin hora = desde las 00:00.
  expect(await ids({ fechaInicio: "2026-10-06", fechaFin: "2026-10-06", horaFin: "17:00" })).toEqual([1, 6, 8]);
});

integrationTest("con hora, el createdat viejo no cuenta y el manual sin fecha_pago queda fuera", async () => {
  // Todo el año: el 7 (fecha_pago NULL) no entra aunque su createdat caiga adentro.
  expect(await ids({ fechaInicio: "2026-01-01", horaInicio: "00:00", fechaFin: "2026-12-31", horaFin: "23:59" }))
    .toEqual([1, 2, 3, 4, 5, 6, 8]);
  // El cierre del día del createdat reusado del 5 (30-mar) no lo trae.
  expect(await ids({ fechaInicio: "2026-03-29", horaInicio: "17:00", fechaFin: "2026-03-30", horaFin: "17:00" })).toEqual([]);
});

integrationTest("sin horas el rango sigue siendo por día como antes", async () => {
  // Filtro de siempre: Nexa por su día bancario; manual con el corrimiento UTC→GT
  // existente (#1780, fuera de alcance): el 05-oct 17:00 se lee 11:00 y el 06-oct
  // 16:59 se lee 10:59, ambos en su día. El 7 (fecha_pago NULL) no entra.
  expect(await ids({ fechaInicio: "2026-10-06", fechaFin: "2026-10-06" })).toEqual([1, 2, 5, 6, 8]);
});
