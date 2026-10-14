import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// `insertPayment` REAL contra Postgres (esquema `cartera` generado desde schema.ts, sin FKs).
// Al cerrar una cuota, `insertPayment` marca `pagado = true` en todas las filas de la cuota. Si
// entre ellas hay una ANULADA (la que dejó la portadora al anularse), quedaba `pagado = true`; un
// Revertir posterior de esa fila zombi entraba por "el pago que cerró la cuota" y le quitaba el
// `pagado` al pago vivo pendiente que sí la cubre: el cron volvía a cobrar mora sobre una cuota
// cubierta (code review I-1 del stack #2027).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const CREDITO = 7002;

type Ctx = { sql: postgres.Sql; insertPayment: typeof import("./registerPayment").insertPayment };
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
      if ((e as { code?: string }).code !== "42710") throw e;
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

/** Crédito de 3 cuotas de Q1,000 (capital 888, interés 100, IVA 12), sin filas de pago. */
const sembrarCredito = async (sql: postgres.Sql) => {
  await sql`TRUNCATE cartera.pagos_credito, cartera.cuotas_credito, cartera.creditos, cartera.usuarios, cartera.bancos RESTART IDENTITY`;
  await sql`INSERT INTO cartera.usuarios (usuario_id, nombre, saldo_a_favor) VALUES (1, 'Cliente prueba', 0)`;
  await sql`INSERT INTO cartera.bancos (banco_id, nombre) VALUES (1, 'GyT')`;
  await sql`INSERT INTO cartera.creditos (credito_id, usuario_id, numero_credito_sifco, capital, porcentaje_interes, deudatotal,
      cuota_interes, cuota, iva_12, seguro_10_cuotas, gps, observaciones, no_poliza, como_se_entero, asesor_id, plazo,
      membresias_pago, membresias, formato_credito, porcentaje_royalti, tipo_credito, royalti, "statusCredit")
    VALUES (${CREDITO}, 1, 'T-7002', 2664, 1.5, 3000, 100, 1000, 12, 0, 0, '', '', '', 1, 3, 0, 0, 'Pool', 0, 'Nuevo', 0, 'ACTIVO')`;
  for (const n of [1, 2, 3]) {
    await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
      VALUES (${n}, ${CREDITO}, ${n}, ${`2026-0${n + 6}-15`}, false)`;
  }
  for (const n of [2, 3]) await fila(sql, { cuota: n, estado: "no_required" });
};

/** Fila de la cuota con `capital` abonado (de 888); el resto de los rubros, sin tocar. */
const fila = async (sql: postgres.Sql, o: { cuota: number; estado: string; anulada?: boolean; capital?: number }) => {
  const capital = o.capital ?? 0;
  const [r] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, "paymentFalse", pagado,
      monto_aplicado, abono_capital, abono_interes, abono_iva_12, capital_restante, interes_restante, iva_12_restante,
      seguro_restante, gps_restante, membresias, membresias_pago, cuota, cuota_interes, pago_convenio, registerby)
    VALUES (${CREDITO}, ${o.cuota}, ${o.estado}, ${o.anulada ?? false}, false, ${capital}, ${capital}, 0, 0,
      ${888 - capital}, 100, 12, 0, 0, 0, 0, 1000, 100, 0, 'x') RETURNING pago_id`;
  return r!.pago_id as number;
};

const pagar = async ({ insertPayment }: Ctx, monto: number) => {
  const set: { status?: number } = {};
  const res = await insertPayment({
    body: {
      credito_id: CREDITO, usuario_id: 1, monto_boleta: monto, fecha_pago: "2026-10-14", fecha_boleta: "2026-10-14",
      cuotaApagar: 1, url_boletas: [], banco_id: 1, numeroAutorizacion: `I1-${monto}-${Date.now()}`, registerBy: "I1",
    },
    set,
  });
  return { status: set.status ?? 200, res: res as { success?: boolean } };
};

const anular = async (pagoId: number) => {
  const { db } = await import("../database");
  const { anularPagoYRestituirMora } = await import("./anularPagoMora");
  const { reabrirCuotaPorAnulacion } = await import("./reabrirCuotaPorAnulacion");
  await db.transaction((tx) =>
    anularPagoYRestituirMora(tx as never, { pago_id: pagoId, credito_id: CREDITO }, {
      updateMora: (async () => ({ success: true })) as never,
      resetAjusteFechaIdeal: (async () => undefined) as never,
      revertirRubros: (async () => []) as never,
      reabrirCuota: reabrirCuotaPorAnulacion,
    }),
  );
};

const revertir = async (pagoId: number) => {
  const { db } = await import("../database");
  const { createReversePayment } = await import("./reversePayment");
  const reversa = createReversePayment({
    runTransaction: db.transaction.bind(db),
    reverseInvestors: (async () => undefined) as never,
    reverseCapitalPayment: (async () => undefined) as never,
    withCreditLock: (async (_id: number, fn: () => Promise<unknown>) => fn()) as never,
    refrescarProyeccion: (async () => undefined) as never,
    restituirMora: (async () => ({ success: true })) as never,
    rechazarSiPagoEsNexa: (async () => undefined) as never,
  });
  const set: { status?: number } = {};
  await reversa({ body: { credito_id: CREDITO, pago_id: pagoId }, set, user: { id: 1 } });
  return set.status ?? 200;
};

const pagadoDe = async (sql: postgres.Sql, pagoId: number) =>
  (await sql`SELECT pagado FROM cartera.pagos_credito WHERE pago_id = ${pagoId}`)[0]!.pagado as boolean;

integrationTest("cierre que sobrescribe la portadora: la anulada sigue sin pagado y revertirla no le quita el pagado al cierre", async () => {
  const ctx = await setup();
  await sembrarCredito(ctx.sql);
  const anulada = await fila(ctx.sql, { cuota: 1, estado: "pending", capital: 400 }); // única fila viva de la cuota 1
  await anular(anulada); // deja la portadora no_required con los restantes repuestos

  const { status } = await pagar(ctx, 1000);
  expect(status).toBe(200);
  const [cierre] = await ctx.sql`SELECT pago_id, pagado, validation_status FROM cartera.pagos_credito
    WHERE cuota_id = 1 AND "paymentFalse" = false`;
  expect(cierre).toMatchObject({ pagado: true, validation_status: "pending" });
  expect(await pagadoDe(ctx.sql, anulada)).toBe(false);

  expect(await revertir(anulada)).toBe(200);
  expect(await pagadoDe(ctx.sql, cierre!.pago_id as number)).toBe(true);
});

integrationTest("cierre que inserta una fila nueva junto a un parcial vivo: la anulada de la cuota sigue sin pagado", async () => {
  const ctx = await setup();
  await sembrarCredito(ctx.sql);
  const parcial = await fila(ctx.sql, { cuota: 1, estado: "validated", capital: 400 });
  const anulada = await fila(ctx.sql, { cuota: 1, estado: "pending", anulada: true, capital: 100 });
  await ctx.sql`UPDATE cartera.pagos_credito SET capital_restante = 488 WHERE pago_id = ${anulada}`;

  const { status } = await pagar(ctx, 600);
  expect(status).toBe(200);
  expect(await pagadoDe(ctx.sql, parcial)).toBe(true);
  expect(await pagadoDe(ctx.sql, anulada)).toBe(false);
});
