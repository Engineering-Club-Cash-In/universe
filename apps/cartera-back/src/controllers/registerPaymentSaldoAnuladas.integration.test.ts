import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Crédito 9331, cuota 2: la semilla (no_required, interés restante 3,010.15) y un parcial validated
// que se ANULA. `insertPayment` tomaba como saldo vigente al parcial anulado (restantes de DESPUÉS del
// pago) y como destino del cierre a la fila anulada. Esta prueba corre la MISMA consulta que usa
// `insertPayment` (`pagosExistentesDeCuota`) y la misma elección de saldo contra Postgres real.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

const COLS_PAGOS = `pago_id serial PRIMARY KEY, credito_id integer, cuota_interes numeric, fecha_pago timestamp,
  abono_capital numeric, abono_interes numeric, abono_iva_12 numeric, abono_interes_ci numeric, abono_iva_ci numeric,
  abono_seguro numeric, abono_gps numeric, pago_del_mes numeric, llamada text, monto_boleta numeric, fecha_vencimiento date,
  renuevo_o_nuevo text, capital_restante numeric, interes_restante numeric, iva_12_restante numeric, seguro_restante numeric,
  gps_restante numeric, total_restante numeric, membresias numeric, membresias_pago numeric, membresias_mes numeric, otros text,
  mora numeric, monto_boleta_cuota numeric, seguro_total numeric, pagado boolean, facturacion text, mes_pagado text,
  seguro_facturado numeric, gps_facturado numeric, reserva numeric, observaciones text, "paymentFalse" boolean NOT NULL DEFAULT false,
  createdat timestamp DEFAULT now(), cuota_id integer, cuota numeric, numeroautorizacion text, validation_status text,
  fecha_limite_pago2 date, banco_id integer, registerby text, cuenta_empresa_id integer, pago_convenio numeric,
  fecha_boleta timestamp, monto_aplicado numeric, fecha_aplicado timestamp, origen_pago text, saldo_a_favor_acreditado numeric,
  nexa_payment_event_id integer, boleta_tardia_intento_id uuid`;

const setup = async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, credito_id integer, numero_cuota integer,
    fecha_vencimiento date, pagado boolean DEFAULT false, liquidado_inversionistas boolean NOT NULL DEFAULT false,
    fecha_liquidacion_inversionistas timestamp, createdat timestamp DEFAULT now())`;
  await sql.unsafe(`CREATE TABLE cartera.pagos_credito (${COLS_PAGOS})`);
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota) VALUES (2, 9331, 2)`;
  return { sql };
};

const insertar = (sql: postgres.Sql, o: { estado: string; falso?: boolean; interes: number; capital: number; aplicado?: number }) =>
  sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, "paymentFalse", pagado, monto_aplicado,
      abono_interes, interes_restante, capital_restante, iva_12_restante, seguro_restante, gps_restante, membresias,
      cuota, cuota_interes, pago_convenio, registerby)
    VALUES (9331, 2, ${o.estado}, ${o.falso ?? false}, ${(o.aplicado ?? 0) > 0}, ${o.aplicado ?? 0},
      ${o.aplicado ?? 0}, ${o.interes}, ${o.capital}, 0, 0, 0, 0, 3000, 3010.15, 0, 'x') RETURNING pago_id`;

integrationTest("con el parcial validated ANULADO, el saldo vigente y el destino del cierre son los de la semilla", async () => {
  const { sql } = await setup();
  await insertar(sql, { estado: "no_required", interes: 3010.15, capital: 5000 });
  await insertar(sql, { estado: "validated", falso: true, interes: 0, capital: 0, aplicado: 3010.15 });

  const { db } = await import("../database");
  const { pagosExistentesDeCuota } = await import("./registerPaymentQueries");
  const { esPagoSaldoElegible } = await import("./registerPaymentPolicy");
  const filas = await pagosExistentesDeCuota(db as never, 2, 9331);

  expect(filas.map((f) => [f.pago.validationStatus, f.pago.paymentFalse])).toEqual([["no_required", false]]);
  const elegible = [...filas].reverse().find(({ pago }) => esPagoSaldoElegible(pago));
  expect(elegible).toBeUndefined(); // sin parcial vivo: el saldo sale de la semilla (pagoOriginal)
  const pagoOriginal = filas.find((f) => f.pago.validationStatus === "no_required");
  expect(Number(pagoOriginal!.pago.interes_restante)).toBe(3010.15);
  await sql.end();
});

integrationTest("un parcial validated VIVO sigue siendo el saldo vigente (no cambia lo que ya funcionaba)", async () => {
  const { sql } = await setup();
  await insertar(sql, { estado: "no_required", interes: 3010.15, capital: 5000 });
  await insertar(sql, { estado: "validated", interes: 1000, capital: 5000, aplicado: 2010.15 });

  const { db } = await import("../database");
  const { pagosExistentesDeCuota } = await import("./registerPaymentQueries");
  const { esPagoSaldoElegible } = await import("./registerPaymentPolicy");
  const filas = await pagosExistentesDeCuota(db as never, 2, 9331);
  const elegible = [...filas].reverse().find(({ pago }) => esPagoSaldoElegible(pago));
  expect(Number(elegible!.pago.interes_restante)).toBe(1000);
  await sql.end();
});
