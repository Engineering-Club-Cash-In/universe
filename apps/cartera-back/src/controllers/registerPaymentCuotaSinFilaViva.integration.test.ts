import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// `insertPayment` REAL contra Postgres, con el esquema `cartera` completo generado desde schema.ts
// (sin FKs: la prueba siembra solo lo que el pago lee). Dos cuotas con TODAS sus filas de pago
// fuera de juego, como el crédito 459 cuota 4 y el 365 cuota 4 de PROD:
//  A) la cerró un pago `pending` (pagado, sin validar) y la semilla está anulada: el pago nuevo no
//     puede volver a cargar la cuota desde la semilla (daba 500 "quedaría sobre-aplicada").
//  B) no le queda ninguna fila viva ni semilla anulada: el pago se rechaza con 409 de integridad
//     ANTES de escribir nada (antes respondía éxito sin escribir la cuota).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const CREDITO = 7001;

type Ctx = {
  sql: postgres.Sql;
  insertPayment: typeof import("./registerPayment").insertPayment;
};
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
      // drizzle-kit no pone paréntesis a `DEFAULT NOW() AT TIME ZONE '…'` y Postgres no lo acepta así.
      await sql.unsafe(stmt.replace(/DEFAULT (NOW\(\) AT TIME ZONE '[^']+')/g, "DEFAULT ($1)"));
      if (tipoPublico) tiposCreados.push(tipoPublico);
    } catch (e) {
      if ((e as { code?: string }).code !== "42710") throw e; // tipo de `public` que ya existe
    }
  }
  const { insertPayment } = await import("./registerPayment");
  return { sql, insertPayment };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql } = await ready;
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  for (const tipo of tiposCreados) await sql.unsafe(`DROP TYPE IF EXISTS public.${tipo}`);
  await sql.end();
});

/** Crédito de 3 cuotas de Q1,000 (capital 888, interés 100, IVA 12) con la semilla viva en las cuotas 2 y 3. */
const sembrarCredito = async (sql: postgres.Sql) => {
  await sql`TRUNCATE cartera.pagos_credito, cartera.cuotas_credito, cartera.creditos, cartera.usuarios, cartera.bancos RESTART IDENTITY`;
  await sql`INSERT INTO cartera.usuarios (usuario_id, nombre, saldo_a_favor) VALUES (1, 'Cliente prueba', 0)`;
  await sql`INSERT INTO cartera.bancos (banco_id, nombre) VALUES (1, 'GyT')`;
  await sql`INSERT INTO cartera.creditos (credito_id, usuario_id, numero_credito_sifco, capital, porcentaje_interes, deudatotal,
      cuota_interes, cuota, iva_12, seguro_10_cuotas, gps, observaciones, no_poliza, como_se_entero, asesor_id, plazo,
      membresias_pago, membresias, formato_credito, porcentaje_royalti, tipo_credito, royalti, "statusCredit")
    VALUES (${CREDITO}, 1, 'T-7001', 2664, 1.5, 3000, 100, 1000, 12, 0, 0, '', '', '', 1, 3, 0, 0, 'Pool', 0, 'Nuevo', 0, 'ACTIVO')`;
  for (const n of [1, 2, 3]) {
    await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
      VALUES (${n}, ${CREDITO}, ${n}, ${`2026-0${n + 6}-15`}, false)`;
  }
  for (const n of [2, 3]) await fila(sql, { cuota: n, estado: "no_required" });
};

const fila = (sql: postgres.Sql, o: { cuota: number; estado: string; anulada?: boolean; pagado?: boolean; aplicado?: number }) => {
  const aplicado = o.aplicado ?? 0;
  const cerrada = aplicado >= 1000;
  return sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, "paymentFalse", pagado, monto_aplicado,
      abono_capital, abono_interes, abono_iva_12, capital_restante, interes_restante, iva_12_restante, seguro_restante,
      gps_restante, membresias, membresias_pago, cuota, cuota_interes, pago_convenio, registerby)
    VALUES (${CREDITO}, ${o.cuota}, ${o.estado}, ${o.anulada ?? false}, ${o.pagado ?? false}, ${aplicado},
      ${cerrada ? 888 : 0}, ${cerrada ? 100 : 0}, ${cerrada ? 12 : 0}, ${cerrada ? 0 : 888}, ${cerrada ? 0 : 100},
      ${cerrada ? 0 : 12}, 0, 0, 0, 0, 1000, 100, 0, 'x')`;
};

const pagar = async ({ insertPayment }: Ctx, monto: number) => {
  const set: { status?: number } = {};
  const res = await insertPayment({
    body: {
      credito_id: CREDITO, usuario_id: 1, monto_boleta: monto, fecha_pago: "2026-10-14", fecha_boleta: "2026-10-14",
      cuotaApagar: 1, url_boletas: [], banco_id: 1, numeroAutorizacion: `R5-${monto}-${Date.now()}`, registerBy: "R5",
    },
    set,
  });
  return { status: set.status ?? 200, res: res as { success?: boolean; message?: string } };
};

const filasPorCuota = async (sql: postgres.Sql) =>
  Object.fromEntries(
    (await sql`SELECT cuota_id, count(*)::int n FROM cartera.pagos_credito WHERE credito_id = ${CREDITO} GROUP BY cuota_id`)
      .map((r) => [r.cuota_id, r.n]),
  );

integrationTest("A) cuota cerrada por un pending sin validar y semilla anulada: el pago pasa a la cuota siguiente", async () => {
  const ctx = await setup();
  await sembrarCredito(ctx.sql);
  await fila(ctx.sql, { cuota: 1, estado: "no_required", anulada: true });
  await fila(ctx.sql, { cuota: 1, estado: "pending", pagado: true, aplicado: 1000 });

  const { status, res } = await pagar(ctx, 500);

  expect({ status, success: res.success }).toEqual({ status: 200, success: true });
  expect(await filasPorCuota(ctx.sql)).toEqual({ 1: 2, 2: 2, 3: 1 }); // la cuota 1 no se toca; la 2 recibe la fila
  const [nueva] = await ctx.sql`SELECT monto_aplicado FROM cartera.pagos_credito
    WHERE cuota_id = 2 AND validation_status = 'pending' AND "paymentFalse" = false`;
  expect(Number(nueva!.monto_aplicado)).toBe(500);
});

integrationTest("B) cuota sin ninguna fila viva ni semilla anulada: 409 de integridad y nada escrito", async () => {
  const ctx = await setup();
  await sembrarCredito(ctx.sql);
  await fila(ctx.sql, { cuota: 1, estado: "validated", anulada: true, pagado: true, aplicado: 400 });

  const { status, res } = await pagar(ctx, 500);

  expect(status).toBe(409);
  expect(res.success).toBe(false);
  expect(res.message).toBe(
    "Inconsistencia de integridad: la cuota #1 no tiene ninguna fila de pago viva; revisá la cuota antes de registrar el pago",
  );
  expect(await filasPorCuota(ctx.sql)).toEqual({ 1: 1, 2: 1, 3: 1 });
  const [u] = await ctx.sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id = 1`;
  expect(Number(u!.saldo_a_favor)).toBe(0);
});
