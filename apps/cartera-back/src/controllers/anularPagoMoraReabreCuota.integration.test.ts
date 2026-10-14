import { expect, test } from "bun:test";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Postgres real: anular (falsePayment) el pago que COMPLETÓ una cuota con un parcial previo.
// `insertPayment` había dejado `pagado = true` y los restantes en 0 en el parcial; sin el
// arreglo el cron ve la cuota cubierta (no cobra su mora) y el pago siguiente la salta.
// Datos del crédito 932 / cuota 48: cuota 2455.61, parcial validado 1161.38, cierre 1294.23.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const migracion = (archivo: string) => Bun.file(new URL(`../../drizzle/${archivo}`, import.meta.url)).text();

const setup = async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TYPE cartera.mora_evento_origen AS ENUM
    ('PROCESO_AUTO','API_MANUAL','CONDONACION_INDIVIDUAL','CONDONACION_MASIVA')`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY,
    numero_credito_sifco text, estado_devolucion text, cuota numeric(18,2), "statusCredit" text, capital numeric(18,2), porcentaje_interes numeric, seguro_10_cuotas numeric, gps numeric, membresias_pago numeric)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY, credito_id integer, pagado boolean DEFAULT false)`;
  await sql`CREATE TABLE cartera.moras_historial (historial_id serial PRIMARY KEY,
    credito_id integer NOT NULL, mora_id integer, tipo_evento text NOT NULL,
    origen cartera.mora_evento_origen NOT NULL,
    monto_anterior numeric(18,2) NOT NULL DEFAULT 0, monto_nuevo numeric(18,2) NOT NULL DEFAULT 0,
    cuotas_atrasadas_anterior integer NOT NULL DEFAULT 0, cuotas_atrasadas_nuevas integer NOT NULL DEFAULT 0,
    capital_credito numeric(18,2), porcentaje_mora numeric(5,4), usuario_id integer, motivo text,
    pago_id integer, fecha timestamp NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer, cuota_id integer, validation_status text,
    monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    abono_interes_ci numeric(18,2), abono_iva_ci numeric(18,2), pago_convenio numeric(18,2) NOT NULL DEFAULT 0,
    capital_restante numeric(18,2), interes_restante numeric(18,2), iva_12_restante numeric(18,2),
    seguro_restante numeric(18,2), gps_restante numeric(18,2), membresias numeric,
    fecha_pago timestamp DEFAULT now(), cuota numeric, cuota_interes numeric, fecha_vencimiento date,
    total_restante numeric(18,2), monto_boleta numeric(18,2), pago_del_mes numeric, renuevo_o_nuevo text,
    membresias_mes numeric, monto_boleta_cuota numeric, seguro_total numeric, facturacion text, mes_pagado text, reserva numeric, observaciones text,
    -- el INSERT de drizzle lista TODAS las columnas (con DEFAULT las no dadas)
    llamada text, seguro_facturado numeric, gps_facturado numeric, numeroautorizacion text, fecha_limite_pago2 date,
    banco_id integer, cuenta_empresa_id integer, fecha_boleta timestamp, fecha_aplicado timestamp, origen_pago text,
    saldo_a_favor_acreditado numeric, registerby varchar(150) NOT NULL DEFAULT 'x',
    pagado boolean, createdat timestamp DEFAULT now(),
    "paymentFalse" boolean NOT NULL DEFAULT false,
    boleta_tardia_intento_id uuid)`;
  await sql.unsafe(await migracion("0039_add_nexa_internal_payments.sql")).simple();
  await sql.unsafe(await migracion("0043_mora_pagada_cuota.sql")).simple();
  await sql.unsafe(await migracion("0050_nexa_evento_pago_eliminado.sql")).simple();
  await sql`INSERT INTO cartera.creditos VALUES (1, 'S-1', NULL, 2455.61, 'ACTIVO', 10000)`;
  await sql`INSERT INTO cartera.cuotas_credito VALUES (48, 1, false)`;
  return { sql };
};

/** Parcial validado + cierre pendiente: el estado que deja insertPayment (todo pagado, restantes en 0). */
const parcialYCierre = async (sql: postgres.Sql, { parcialAbono = 1161.38 } = {}) => {
  const [parcial] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'validated', ${parcialAbono}, ${parcialAbono}, 0, 0, 0, 0, 0, 0, true, 0, 0, 0, 0, 0, 0)
    RETURNING pago_id`;
  const [cierre] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'pending', 1294.23, 1294.23, 0, 0, 0, 0, 0, 258.08, true, 0, 0, 0, 0, 0, 0)
    RETURNING pago_id`;
  return { parcialId: parcial!.pago_id as number, cierreId: cierre!.pago_id as number };
};

/** Lo mismo que mira el cron para decir "esta cuota ya la cubre un pago" (hasPaidPaymentSql). */
const cronLaVeCubierta = async (sql: postgres.Sql) => {
  const { hasPaidPaymentSql } = await import("../utils/cuotaYaPagadaSql");
  const { db } = await import("../database");
  const { cuotas_credito } = await import("../database/db/schema");
  const { eq } = await import("drizzle-orm");
  const [fila] = await db
    .select({ cubierta: hasPaidPaymentSql() })
    .from(cuotas_credito)
    .where(eq(cuotas_credito.cuota_id, 48));
  return fila!.cubierta as boolean;
};

const anular = async (pagoId: number, conReapertura = true) => {
  const { db } = await import("../database");
  const { anularPagoYRestituirMora } = await import("./anularPagoMora");
  const { reabrirCuotaPorAnulacion } = await import("./reabrirCuotaPorAnulacion");
  await db.transaction((tx) =>
    anularPagoYRestituirMora(tx as never, { pago_id: pagoId, credito_id: 1 }, {
      updateMora: (async () => ({ success: true })) as never,
      resetAjusteFechaIdeal: (async () => undefined) as never,
      revertirRubros: (async () => []) as never,
      ...(conReapertura ? { reabrirCuota: reabrirCuotaPorAnulacion } : {}),
    }),
  );
};

integrationTest("anular el pago que completó la cuota la reabre: el cron deja de verla cubierta y los restantes vuelven", async () => {
  const { sql } = await setup();
  const { parcialId, cierreId } = await parcialYCierre(sql);
  expect(await cronLaVeCubierta(sql)).toBe(true);
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`; // RAMA B al validar

  await anular(cierreId);

  const [parcial] = await sql`SELECT pagado, capital_restante::float AS capital, interes_restante::float AS interes
    FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial).toMatchObject({ pagado: false, capital: 1294.23, interes: 0 });
  const [anulada] = await sql`SELECT "paymentFalse", pagado FROM cartera.pagos_credito WHERE pago_id = ${cierreId}`;
  expect(anulada).toMatchObject({ paymentFalse: true, pagado: false });
  const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
  expect(cuota!.pagado).toBe(false);
  expect(await cronLaVeCubierta(sql)).toBe(false);

  // El siguiente pago elige como saldo vigente la fila viva de pago_id más alto con restante:
  // tiene que ver los 1294.23 que faltan en la cuota 48 (con 0 se la saltaba).
  const [vigente] = await sql`SELECT capital_restante::float AS capital FROM cartera.pagos_credito
    WHERE cuota_id = 48 AND credito_id = 1 AND "paymentFalse" = false ORDER BY pago_id DESC LIMIT 1`;
  expect(vigente!.capital).toBe(1294.23);
  await sql.end();
});

integrationTest("las hermanas que cubren la cuota solas: anular otro pago no reabre nada", async () => {
  const { sql } = await setup();
  const { parcialId, cierreId } = await parcialYCierre(sql, { parcialAbono: 2455.61 });
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;

  await anular(cierreId);

  const [parcial] = await sql`SELECT pagado, capital_restante::float AS capital FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial).toMatchObject({ pagado: true, capital: 0 });
  const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
  expect(cuota!.pagado).toBe(true);
  expect(await cronLaVeCubierta(sql)).toBe(true);
  await sql.end();
});

integrationTest("un pago de solo mora (sin abonos a la cuota) no reabre ni repone nada", async () => {
  const { sql } = await setup();
  const { parcialId } = await parcialYCierre(sql);
  const [soloMora] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'validated', 50, 0, 0, 0, 0, 0, 0, 50, true, 0, 0, 0, 0, 0, 0) RETURNING pago_id`;

  await anular(soloMora!.pago_id as number);

  const [parcial] = await sql`SELECT pagado, capital_restante::float AS capital FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial).toMatchObject({ pagado: true, capital: 0 });
  await sql.end();
});

integrationTest("crédito PENDIENTE_CANCELACION: la cuota también se reabre (ACTIVAR lo devuelve a ACTIVO sin tocar cuotas)", async () => {
  const { sql } = await setup();
  await sql`UPDATE cartera.creditos SET "statusCredit" = 'PENDIENTE_CANCELACION' WHERE credito_id = 1`;
  const { parcialId, cierreId } = await parcialYCierre(sql);
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;

  await anular(cierreId);

  const [parcial] = await sql`SELECT pagado, capital_restante::float AS capital FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial).toMatchObject({ pagado: false, capital: 1294.23 });
  const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
  expect(cuota!.pagado).toBe(false);
  await sql.end();
});

integrationTest("una hermana no_required con plata (SIFCO) que cubre la cuota sola: anular el cierre no reabre nada", async () => {
  const { sql } = await setup();
  const [sifco] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'no_required', 2455.61, 2455.61, 0, 0, 0, 0, 0, 0, true, 0, 0, 0, 0, 0, 0) RETURNING pago_id`;
  const [cierre] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'pending', 100, 100, 0, 0, 0, 0, 0, 0, true, 0, 0, 0, 0, 0, 0) RETURNING pago_id`;
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;

  await anular(cierre!.pago_id as number);

  const [fila] = await sql`SELECT pagado, capital_restante::float AS capital FROM cartera.pagos_credito WHERE pago_id = ${sifco!.pago_id}`;
  expect(fila).toMatchObject({ pagado: true, capital: 0 });
  const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
  expect(cuota!.pagado).toBe(true);
  await sql.end();
});

integrationTest("INCOBRABLE con capital 0: anular el cierre validated con abono_capital reabre la cuota (la validación ya lo había restado)", async () => {
  const { sql } = await setup();
  await sql`UPDATE cartera.creditos SET "statusCredit" = 'INCOBRABLE', capital = 0 WHERE credito_id = 1`;
  const { parcialId, cierreId } = await parcialYCierre(sql);
  await sql`UPDATE cartera.pagos_credito SET validation_status = 'validated' WHERE pago_id = ${cierreId}`;
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;

  await anular(cierreId);

  const [parcial] = await sql`SELECT pagado, capital_restante::float AS capital FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial).toMatchObject({ pagado: false, capital: 1294.23 });
  const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
  expect(cuota!.pagado).toBe(false);
  await sql.end();
});

integrationTest("anular un abono directo a capital no replica capital_restante a las hermanas", async () => {
  const { sql } = await setup();
  const { parcialId } = await parcialYCierre(sql);
  const [directo] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'capital_validated', 300, 300, 0, 0, 0, 0, 0, 0, true, 9700, 0, 0, 0, 0, 0) RETURNING pago_id`;

  await anular(directo!.pago_id as number);

  const [parcial] = await sql`SELECT pagado, capital_restante::float AS capital FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial).toMatchObject({ pagado: true, capital: 0 });
  await sql.end();
});

/** Una cuota cuyo ÚNICO pago vivo (completo, sobrescribió la semilla) se anula. */
const unicoPago = async (sql: postgres.Sql, estado: "validated" | "pending") => {
  const [p] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado, cuota, cuota_interes, fecha_vencimiento, total_restante,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias,
       seguro_facturado, gps_facturado, pago_del_mes)
    VALUES (1, 48, ${estado}, 2455.61, 1005.44, 1314.37, 157.72, 271.66, 0, 570.84, 0, true, 2455.61, 1314.37, '2026-09-12', 8000,
       0, 0, 0, 0, 0, 0, 2716.6, 100, 2455.61) RETURNING pago_id`;
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;
  return p!.pago_id as number;
};

for (const estado of ["validated", "pending"] as const) {
  integrationTest(`anular el ÚNICO pago ${estado} de la cuota deja una fila portadora no_required con los restantes repuestos`, async () => {
    const { sql } = await setup();
    const pagoId = await unicoPago(sql, estado);

    await anular(pagoId);

    const vivas = await sql`SELECT validation_status, pagado, "paymentFalse", monto_aplicado::float AS aplicado,
        abono_capital::float AS abono, capital_restante::float AS capital, interes_restante::float AS interes,
        iva_12_restante::float AS iva, seguro_restante::float AS seguro, membresias::float AS membresias,
        cuota::float AS cuota, fecha_vencimiento::text AS venc, total_restante::float AS total,
        seguro_facturado::float AS sf, gps_facturado::float AS gf, pago_del_mes::float AS pdm
      FROM cartera.pagos_credito WHERE cuota_id = 48 AND "paymentFalse" = false`;
    expect(vivas).toHaveLength(1);
    expect(vivas[0]).toMatchObject({
      validation_status: "no_required", pagado: false, paymentFalse: false, aplicado: 0, abono: 0,
      capital: 1005.44, interes: 1314.37, iva: 157.72, seguro: 271.66, membresias: 570.84,
      cuota: 2455.61, venc: "2026-09-12", total: 8000, sf: 2716.6, gf: 100, pdm: 2455.61,
    });
    const [anulada] = await sql`SELECT "paymentFalse", abono_capital::float AS abono FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
    expect(anulada).toMatchObject({ paymentFalse: true, abono: 1005.44 });
    const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
    expect(cuota!.pagado).toBe(false);
    await sql.end();
  });
}

integrationTest("con una hermana viva que no cubre no se inserta portadora", async () => {
  const { sql } = await setup();
  const { cierreId } = await parcialYCierre(sql);
  await anular(cierreId);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.pagos_credito WHERE cuota_id = 48 AND "paymentFalse" = false`;
  expect(n).toBe(1);
  await sql.end();
});

integrationTest("reabrir las filas no le quita el pagado a las capital_validated ni a las reset de la cuota", async () => {
  const { sql } = await setup();
  const { parcialId, cierreId } = await parcialYCierre(sql);
  const otras = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'capital_validated', 300, 300, 0, 0, 0, 0, 0, 0, true, 0, 0, 0, 0, 0, 0),
           (1, 48, 'reset', 200, 200, 0, 0, 0, 0, 0, 0, true, 0, 0, 0, 0, 0, 0) RETURNING pago_id`;
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;

  await anular(cierreId);

  const [parcial] = await sql`SELECT pagado FROM cartera.pagos_credito WHERE pago_id = ${parcialId}`;
  expect(parcial!.pagado).toBe(false);
  const filas = await sql`SELECT pagado FROM cartera.pagos_credito
    WHERE pago_id IN ${sql(otras.map((o) => o.pago_id as number))}`;
  expect(filas.map((f) => f.pagado)).toEqual([true, true]);
  await sql.end();
});

integrationTest("crédito CANCELADO: anular el ÚNICO pago repone restantes en la anulada pero no deja portadora", async () => {
  const { sql } = await setup();
  await sql`UPDATE cartera.creditos SET "statusCredit" = 'CANCELADO' WHERE credito_id = 1`;
  const pagoId = await unicoPago(sql, "pending"); // pending: no movió capital, se puede anular en CANCELADO

  await anular(pagoId);

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.pagos_credito WHERE cuota_id = 48 AND "paymentFalse" = false`;
  expect(n).toBe(0);
  const [cuota] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 48`;
  expect(cuota!.pagado).toBe(true);
  await sql.end();
});

integrationTest("anular un pago stale-zero (abonos 0, monto_aplicado = cuota) que cerró la cuota: 409 y nada escrito", async () => {
  const { sql } = await setup();
  const [fila] = await sql`INSERT INTO cartera.pagos_credito
      (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, abono_interes, abono_iva_12,
       abono_seguro, abono_gps, membresias_pago, mora, otros, pagado,
       capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias)
    VALUES (1, 48, 'validated', 2505.61, 0, 0, 0, 0, 0, 0, 50, '', true, 0, 0, 0, 0, 0, 0)
    RETURNING pago_id`;
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 48`;
  const foto = async () => JSON.stringify([
    await sql`SELECT * FROM cartera.pagos_credito ORDER BY pago_id`,
    await sql`SELECT * FROM cartera.cuotas_credito ORDER BY cuota_id`,
    await sql`SELECT * FROM cartera.creditos`,
  ]);
  const antes = await foto();

  const { AnulacionSinDesgloseError } = await import("./reabrirCuotaPorAnulacionPolicy");
  const error = await anular(fila!.pago_id as number).then(() => null, (e: unknown) => e);

  expect(error).toBeInstanceOf(AnulacionSinDesgloseError);
  expect((error as { status: number }).status).toBe(409);
  expect(await foto()).toBe(antes); // la fila sigue viva y pagada, la cuota cerrada, sin portadora
  await sql.end();
});
