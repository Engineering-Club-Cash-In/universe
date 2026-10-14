import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Postgres real, esquema `cartera` completo desde schema.ts (sin FKs ni triggers). Anular un pago
// que ya bajó capital: el crédito y los inversionistas recuperan el abono en la MISMA transacción
// que marca la fila; si algo no se puede reponer, 409 y la base queda como estaba.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const CREDITO = 8001;

type Ctx = { sql: postgres.Sql };
let ready: Promise<Ctx> | undefined;
const tiposCreados: string[] = [];
const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  const schema = await import("../database/db/schema");
  const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  for (const stmt of ddl.filter((s) => !s.includes("FOREIGN KEY"))) {
    const tipoPublico = /CREATE TYPE "public"\.("[a-z_]+")/.exec(stmt)?.[1];
    try {
      await sql.unsafe(stmt.replace(/DEFAULT (NOW\(\) AT TIME ZONE '[^']+')/g, "DEFAULT ($1)"));
      if (tipoPublico) tiposCreados.push(tipoPublico);
    } catch (e) {
      if ((e as { code?: string }).code !== "42710") throw e; // tipo de `public` que ya existe
    }
  }
  return { sql };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql } = await ready;
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  for (const tipo of tiposCreados) await sql.unsafe(`DROP TYPE IF EXISTS public.${tipo}`);
  await sql.end();
});

/**
 * Crédito de cuota 1,000 ya cerrada por un pago `estado` que bajó `abono` de capital. Inversionistas
 * 1 y 2 aportan `capital` entre los dos; la PCI del pago reparte el abono según `pci`.
 */
const sembrar = async (
  sql: postgres.Sql,
  o: { status?: string; capital?: number; abono?: number; estado?: string; pci?: Array<[number, number]>; registerBy?: string },
) => {
  const capital = o.capital ?? 9000;
  const abono = o.abono ?? 500;
  await sql`TRUNCATE cartera.pagos_credito, cartera.cuotas_credito, cartera.creditos, cartera.creditos_inversionistas,
    cartera.pagos_credito_inversionistas, cartera.abonos_capital, cartera.mora_pagada_cuota, cartera.moras_historial RESTART IDENTITY`;
  await sql`INSERT INTO cartera.creditos (credito_id, usuario_id, numero_credito_sifco, capital, porcentaje_interes, deudatotal,
      cuota_interes, cuota, iva_12, seguro_10_cuotas, gps, observaciones, no_poliza, como_se_entero, asesor_id, plazo,
      membresias_pago, membresias, formato_credito, porcentaje_royalti, tipo_credito, royalti, "statusCredit")
    VALUES (${CREDITO}, 1, 'T-8001', ${capital}, 1.5, 0, 0, 1000, 0, 0, 0, '', '', '', 1, 12, 0, 0, 'Pool', 0, 'Nuevo', 0,
      ${o.status ?? "ACTIVO"})`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
    VALUES (1, ${CREDITO}, 1, '2026-09-15', true)`;
  const mitad = capital / 2;
  for (const inv of [1, 2]) {
    await sql`INSERT INTO cartera.creditos_inversionistas (credito_id, inversionista_id, monto_aportado,
        porcentaje_participacion_inversionista, porcentaje_cash_in, cuota_inversionista, monto_inversionista, monto_cash_in, fecha_creacion)
      VALUES (${CREDITO}, ${inv}, ${mitad}, 70, 30, 0, 0, 0, now())`;
  }
  const [pago] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, "paymentFalse", pagado,
      monto_aplicado, abono_capital, abono_interes, abono_iva_12, abono_seguro, abono_gps, membresias_pago, mora,
      capital_restante, interes_restante, iva_12_restante, seguro_restante, gps_restante, membresias,
      cuota, cuota_interes, pago_convenio, registerby)
    VALUES (${CREDITO}, 1, ${o.estado ?? "validated"}, false, true, 1000, ${abono}, ${1000 - abono}, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 1000, ${1000 - abono}, 0, ${o.registerBy ?? "asesor"})
    RETURNING pago_id`;
  const pagoId = pago!.pago_id as number;
  for (const [inv, monto] of o.pci ?? [[1, abono / 2], [2, abono / 2]]) {
    await sql`INSERT INTO cartera.pagos_credito_inversionistas (pago_id, inversionista_id, credito_id, abono_capital,
        abono_interes, abono_iva_12, porcentaje_participacion, cuota, fecha_pago)
      VALUES (${pagoId}, ${inv}, ${CREDITO}, ${monto}, 0, 0, 50, 1000, now())`;
  }
  return pagoId;
};

const anular = async (pagoId: number) => {
  const { db } = await import("../database");
  const { anularPagoYRestituirMora, DEPS_REALES } = await import("./anularPagoMora");
  const reales = DEPS_REALES();
  return db.transaction((tx) =>
    anularPagoYRestituirMora(tx as never, { pago_id: pagoId, credito_id: CREDITO }, {
      updateMora: (async () => ({ success: true })) as never,
      resetAjusteFechaIdeal: (async () => undefined) as never,
      revertirRubros: (async () => []) as never,
      reabrirCuota: reales.reabrirCuota,
      restituirCapital: reales.restituirCapital,
    }),
  );
};

const foto = async (sql: postgres.Sql, pagoId: number) => {
  const [c] = await sql`SELECT capital::text, cuota_interes::text FROM cartera.creditos WHERE credito_id = ${CREDITO}`;
  const invs = await sql`SELECT inversionista_id, monto_aportado::text FROM cartera.creditos_inversionistas
    WHERE credito_id = ${CREDITO} ORDER BY inversionista_id`;
  const [{ suma }] = await sql`SELECT round(sum(monto_aportado), 2)::text AS suma FROM cartera.creditos_inversionistas
    WHERE credito_id = ${CREDITO}`;
  const [{ pci }] = await sql`SELECT count(*)::int AS pci FROM cartera.pagos_credito_inversionistas WHERE pago_id = ${pagoId}`;
  const [p] = await sql`SELECT "paymentFalse" FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`;
  const [q] = await sql`SELECT pagado FROM cartera.cuotas_credito WHERE cuota_id = 1`;
  return {
    capital: c!.capital, cuotaInteres: c!.cuota_interes, suma, pci, paymentFalse: p!.paymentFalse, cuotaPagada: q!.pagado,
    inversionistas: invs.map((i) => [i.inversionista_id, i.monto_aportado]),
  };
};

integrationTest("1) validated con PCI: capital + abono, Σ monto_aportado = capital y sin PCI del pago", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, {});

  await anular(pagoId);

  expect(await foto(sql, pagoId)).toEqual({
    capital: "9500.00", cuotaInteres: "142.50", suma: "9500.00", pci: 0, paymentFalse: true, cuotaPagada: false,
    inversionistas: [[1, "4750.00000000"], [2, "4750.00000000"]],
  });
});

integrationTest("2) (e) inversionista que ya no está: 409 y la base queda intacta (rollback)", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { pci: [[1, 250], [99, 250]] });
  const antes = await foto(sql, pagoId);

  await expect(anular(pagoId)).rejects.toMatchObject({ status: 409, code: "INVERSIONISTA_YA_NO_ESTA" });

  expect(await foto(sql, pagoId)).toEqual(antes);
  expect(antes).toMatchObject({ paymentFalse: false, capital: "9000.00", pci: 2, cuotaPagada: true });
});

integrationTest("3) capital_validated (abono directo): 409 ABONO_DIRECTO_NO_SOPORTADO sin tocar nada", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { estado: "capital_validated" });
  const antes = await foto(sql, pagoId);

  await expect(anular(pagoId)).rejects.toMatchObject({ status: 409, code: "ABONO_DIRECTO_NO_SOPORTADO" });

  expect(await foto(sql, pagoId)).toEqual(antes);
});

integrationTest("3b) validated en cuota cerrada sin ninguna PCI (histórico): 409 CUOTA_CERRADA_SIN_REPARTO", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { pci: [] });
  const antes = await foto(sql, pagoId);

  await expect(anular(pagoId)).rejects.toMatchObject({ status: 409, code: "CUOTA_CERRADA_SIN_REPARTO" });

  expect(await foto(sql, pagoId)).toEqual(antes);
});

integrationTest("3c) rama A (cuota abierta, sin PCI): solo se repone el capital", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { pci: [] });
  await sql`UPDATE cartera.cuotas_credito SET pagado = false WHERE cuota_id = 1`;

  await anular(pagoId);

  expect(await foto(sql, pagoId)).toMatchObject({
    capital: "9500.00", suma: "9000.00", inversionistas: [[1, "4500.00000000"], [2, "4500.00000000"]],
  });
});

integrationTest("4) anular dos veces no repone dos veces", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, {});
  await anular(pagoId);
  const despues = await foto(sql, pagoId);

  await expect(anular(pagoId)).rejects.toThrow("No payment found to mark as false");

  expect(await foto(sql, pagoId)).toEqual(despues);
  expect(despues.capital).toBe("9500.00");
});

integrationTest("5) INCOBRABLE en capital 0: la cuota se reabre y el capital se repone UNA vez, sin interés", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { status: "INCOBRABLE", capital: 0, abono: 500 });

  await anular(pagoId);

  expect(await foto(sql, pagoId)).toEqual({
    capital: "500.00", cuotaInteres: "0.00", suma: "500.00", pci: 0, paymentFalse: true, cuotaPagada: false,
    inversionistas: [[1, "250.00000000"], [2, "250.00000000"]],
  });
});

integrationTest("5b) INCOBRABLE capital 0 y abono 0.01: la reapertura decide ANTES de reponer (la cuota sigue pagada)", async () => {
  // capitalPrevio = 0 + 0.01 ≤ tolerancia → la cuota queda pagada. Si el capital se repusiera antes
  // de reabrir, capitalPrevio sería 0.02 y la cuota se reabriría.
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { status: "INCOBRABLE", capital: 0, abono: 0.01, pci: [[1, 0.01]] });

  await anular(pagoId);

  expect(await foto(sql, pagoId)).toMatchObject({ capital: "0.01", suma: "0.01", cuotaPagada: true, paymentFalse: true });
});

integrationTest("6) por la ruta real (falsePayment → anularPagoYRestituirMoraSerializado): 409 tipado y nada escrito", async () => {
  const { sql } = await setup();
  const pagoId = await sembrar(sql, { pci: [[1, 250], [99, 250]] });
  await sql`INSERT INTO cartera.creditos_inversionistas_espejo (credito_id, inversionista_id, cuota_inversionista,
      porcentaje_participacion_inversionista, monto_aportado, fecha_creacion)
    VALUES (${CREDITO}, 1, 0, 70, 4500, now())`;
  const antes = await foto(sql, pagoId);
  const { falsePayment } = await import("./payments");
  const { AnulacionCapitalNoRestituibleError } = await import("./restitucionCapitalError");

  const error = await falsePayment(pagoId, CREDITO).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(AnulacionCapitalNoRestituibleError);
  expect(error).toMatchObject({ status: 409, code: "INVERSIONISTA_YA_NO_ESTA" });
  expect(await foto(sql, pagoId)).toEqual(antes);
});

for (const ruta of ["reversePayment", "revertPaymentToPending"] as const) {
  integrationTest(`7) anular y después ${ruta}: 409 "ya está anulado", capital y Σ aportado intactos`, async () => {
    const { sql } = await setup();
    const pagoId = await sembrar(sql, {});
    await anular(pagoId);
    const anulado = await foto(sql, pagoId);
    const handler = (await import(`./${ruta}`))[ruta];
    const set: { status?: number } = {};

    const res = await handler({ body: { credito_id: CREDITO, pago_id: pagoId }, set });

    expect(set.status).toBe(409);
    expect(res).toMatchObject({
      success: false,
      message: "El pago ya está anulado: no se puede revertir ni volver a pendiente",
    });
    expect(await foto(sql, pagoId)).toEqual(anulado);
    expect(anulado).toMatchObject({ capital: "9500.00", suma: "9500.00" });
  });
}
