import { afterAll, expect, spyOn, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Condonación Nexa a tiempo sostenida por un pago PENDIENTE, contra Postgres
// REAL con las migraciones 0043, 0051 y 0052 tal cual:
//  - una cuota vencida ya cubierta por un pendiente (toma = 0): se condona y la
//    condonación queda marcada con ese pago (columna, motivo y log);
//  - si el pendiente se anula (falsePayment / anularPagoMora) o se revierte
//    (reversePayment) sin validarse, la condonación se anula sola: la mora
//    vuelve y el ledger queda compensado;
//  - validado, la condonación se queda;
//  - un parcial pendiente que el pago Nexa completaría sigue sin condonar;
//  - una condonación sin pendientes no se toca al anular otro pago.
// Fechas relativas a HOY en Guatemala: la cuota 5 venció ayer (3.73 de mora
// sobre Q10,000) y el pago Nexa llega hoy por Q1,000.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

type Sql = ReturnType<typeof postgres>;
let ready: Promise<{
  sql: Sql;
  hoy: string;
  runtime: typeof import("./nexaPaymentRuntime");
  latefee: typeof import("./latefee");
  anularPagoMora: typeof import("./anularPagoMora");
  pagoPendiente: typeof import("./condonacionNexaPagoPendiente");
  database: typeof import("../database");
}> | undefined;

const migracion = (nombre: string) => Bun.file(new URL(`../../drizzle/${nombre}`, import.meta.url)).text();

const setup = () => (ready ??= (async () => {
  parseTestDatabaseUrl(testDatabaseUrl!);
  process.env.SUPABASE_DB_URL = testDatabaseUrl;
  // nexaPaymentRuntime arrastra el paquete de email, que exige estas al importar.
  process.env.RESEND_API_KEY ??= "re_test_only";
  process.env.EMAIL_DOMAIN ??= "example.test";
  const sql = postgres(testDatabaseUrl!, { ssl: false, onnotice: () => undefined });
  await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
  await sql`CREATE SCHEMA cartera`;
  await sql`CREATE TYPE cartera.mora_evento_origen AS ENUM
    ('PROCESO_AUTO','API_MANUAL','CONDONACION_INDIVIDUAL','CONDONACION_MASIVA')`;
  await sql`CREATE TABLE cartera.creditos (credito_id integer PRIMARY KEY,
    numero_credito_sifco text UNIQUE, "statusCredit" text, capital numeric(18,2), cuota numeric(18,2),
    estado_devolucion text)`;
  await sql`CREATE TABLE cartera.cuotas_credito (cuota_id integer PRIMARY KEY,
    credito_id integer NOT NULL REFERENCES cartera.creditos(credito_id),
    numero_cuota integer NOT NULL, fecha_vencimiento timestamp NOT NULL, pagado boolean NOT NULL DEFAULT false)`;
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
  // nexa_payment_event_id lo agrega 0039 (con su FK a nexa_payment_events).
  await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY,
    credito_id integer REFERENCES cartera.creditos(credito_id), cuota_id integer,
    validation_status text, "paymentFalse" boolean NOT NULL DEFAULT false, pagado boolean NOT NULL DEFAULT false,
    fecha_pago timestamp, monto_aplicado numeric(18,2) NOT NULL DEFAULT 0, abono_capital numeric(18,2),
    abono_interes numeric(18,2), abono_iva_12 numeric(18,2), abono_seguro numeric(18,2),
    abono_gps numeric(18,2), membresias_pago numeric, mora numeric(18,2), otros text,
    createdat timestamp DEFAULT now())`;
  await sql`CREATE TABLE cartera.ajuste_fecha_ideal_pago (id serial PRIMARY KEY, credito_id integer NOT NULL,
    monto_total numeric(18,2) NOT NULL, fecha_cobro timestamptz, pago_id integer)`;
  await sql`CREATE TABLE cartera.rubros_tipos (tipo_id serial PRIMARY KEY, obligatorio boolean NOT NULL DEFAULT false)`;
  await sql`CREATE TABLE cartera.rubros (rubro_id serial PRIMARY KEY, credito_id integer NOT NULL,
    tipo_id integer NOT NULL, saldo_pendiente numeric(18,2) NOT NULL, activo boolean NOT NULL DEFAULT true,
    completado boolean NOT NULL DEFAULT false, anulado boolean NOT NULL DEFAULT false, created_at timestamp DEFAULT now())`;
  await sql.unsafe(await migracion("0039_add_nexa_internal_payments.sql")).simple();
  await sql.unsafe(await migracion("0043_mora_pagada_cuota.sql")).simple();
  await sql.unsafe(await migracion("0050_nexa_evento_pago_eliminado.sql")).simple();
  await sql.unsafe(await migracion("0051_condonacion_nexa_a_tiempo.sql")).simple();
  // 0052 dos veces: se aplica a mano y tiene que ser idempotente.
  await sql.unsafe(await migracion("0052_condonacion_nexa_pagos_pendientes.sql")).simple();
  await sql.unsafe(await migracion("0052_condonacion_nexa_pagos_pendientes.sql")).simple();
  const [{ hoy }] = await sql`SELECT to_char((now() AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') AS hoy`;
  return {
    sql,
    hoy: hoy as string,
    database: await import("../database"),
    runtime: await import("./nexaPaymentRuntime"),
    latefee: await import("./latefee"),
    anularPagoMora: await import("./anularPagoMora"),
    pagoPendiente: await import("./condonacionNexaPagoPendiente"),
  };
})());

afterAll(async () => {
  if (!ready) return;
  const { sql, database } = await ready;
  await sql.end();
  await database.client.end();
  await database.lockPool.end();
});

/**
 * Crédito MOROSO, capital 10,000, cuota 1,000: la 5 venció ayer (3.73 de mora) y la 6 vence en un
 * mes. Con `pendienteCuota4`, la cuota 4 venció hace 20 días y la cubre COMPLETA un pago pendiente
 * de hace 2 días (pagado=true: el cron no le cobra mora mientras dure la gracia de 7 días).
 * Devuelve el pago_id de ese pendiente.
 */
const credito = async (sql: Sql, id: number, pendienteCuota4 = true) => {
  await sql`INSERT INTO cartera.creditos (credito_id, numero_credito_sifco, "statusCredit", capital, cuota)
    VALUES (${id}, ${`S-${id}`}, 'MOROSO', 10000, 1000)`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento) VALUES
    (${id * 10 + 4}, ${id}, 4, (now() AT TIME ZONE 'America/Guatemala')::date - 20),
    (${id * 10 + 5}, ${id}, 5, (now() AT TIME ZONE 'America/Guatemala')::date - 1),
    (${id * 10 + 6}, ${id}, 6, (now() AT TIME ZONE 'America/Guatemala')::date + 30)`;
  await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas) VALUES (${id}, 3.73, 1)`;
  const estado = pendienteCuota4 ? "pending" : "validated";
  const [p] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago,
      monto_aplicado, abono_capital, abono_interes, abono_iva_12, mora)
    VALUES (${id}, ${id * 10 + 4}, ${estado}, true, (now() AT TIME ZONE 'America/Guatemala')::date - 2, 1000, 600, 300, 100, 0)
    RETURNING pago_id`;
  return p!.pago_id as number;
};
const pagoNexa = (hoy: string, creditoId: number, amount = "1000.00") => ({
  externalReference: `ach-${creditoId}`,
  creditoId,
  amount,
  currency: "GTQ" as const,
  tokenDate: `${hoy}T12:00:00Z`,
  token: "1111222233334444",
});
const condonacion = async (sql: Sql, creditoId: number) => {
  const filas = await sql`SELECT monto_condonacion, motivo, pagos_pendientes_ids, anulada_at
    FROM cartera.moras_condonaciones WHERE credito_id = ${creditoId}`;
  return filas.map((f) => ({
    monto_condonacion: String(f.monto_condonacion),
    motivo: String(f.motivo),
    pagos_pendientes_ids: f.pagos_pendientes_ids as number[] | null,
    anulada: f.anulada_at !== null,
  }));
};
const mora = async (sql: Sql, creditoId: number) =>
  String((await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${creditoId}`)[0]!.monto_mora);
const ledger = async (sql: Sql, creditoId: number) =>
  (await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = ${creditoId} ORDER BY id`).map((t) => t.tipo);

/** Condona con el pendiente de la cuota 4 sosteniendo el "al día"; devuelve el pendiente. */
const condonarConPendiente = async (ctx: Awaited<ReturnType<typeof setup>>, creditoId: number) => {
  const pendiente = await credito(ctx.sql, creditoId);
  const warns = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    expect(await ctx.runtime.condonarMoraNexaATiempo(pagoNexa(ctx.hoy, creditoId), 100 + creditoId))
      .toEqual({ monto: "3.73" });
    const log = warns.mock.calls.map((c) => String(c[0])).find((l) => l.includes("con_pago_pendiente"));
    expect(JSON.parse(log!)).toMatchObject({
      nexa_payment_event_id: 100 + creditoId, credito_id: creditoId, pagos_pendientes_ids: [pendiente],
    });
  } finally {
    warns.mockRestore();
  }
  return pendiente;
};

/** falsePayment: la transacción real de anularPagoYRestituirMora (sin rubros ni ajuste). */
const anularPago = async (ctx: Awaited<ReturnType<typeof setup>>, creditoId: number, pagoId: number) => {
  const warns = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await ctx.database.db.transaction((tx) => ctx.anularPagoMora.anularPagoYRestituirMora(
      tx as never,
      { pago_id: pagoId, credito_id: creditoId },
      {
        updateMora: ctx.latefee.updateMora,
        resetAjusteFechaIdeal: (async () => undefined) as never,
        revertirRubros: (async () => []) as never,
        anularCondonacionesPorPagoPendiente: ctx.pagoPendiente.anularCondonacionesNexaPorPagoPendiente,
      },
    ));
    return warns.mock.calls.map((c) => String(c[0]));
  } finally {
    warns.mockRestore();
  }
};

integrationTest("cuota vencida cubierta COMPLETA por un pendiente (toma = 0): se condona y queda marcada con ese pago", async () => {
  const ctx = await setup();
  const pendiente = await condonarConPendiente(ctx, 1);
  expect(await condonacion(ctx.sql, 1)).toEqual([{
    monto_condonacion: "3.73",
    motivo: `NEXA_ACH_A_TIEMPO — CON PAGO PENDIENTE: se sostiene en el pago ${pendiente}, si no se valida(n) se anula`,
    pagos_pendientes_ids: [pendiente],
    anulada: false,
  }]);
  expect(await mora(ctx.sql, 1)).toBe("0.00");
  // El reporte de condonaciones muestra la marca en el motivo legible.
  expect(ctx.latefee.textoMotivoCondonacion((await condonacion(ctx.sql, 1))[0]!.motivo))
    .toContain(`Pago Nexa a tiempo (ACH) — CON PAGO PENDIENTE: se sostiene en el pago ${pendiente}`);
});

integrationTest("el pendiente se ANULA (falsePayment): la condonación se anula sola, la mora vuelve y queda la constancia", async () => {
  const ctx = await setup();
  const pendiente = await condonarConPendiente(ctx, 2);
  const logs = await anularPago(ctx, 2, pendiente);

  expect(await condonacion(ctx.sql, 2)).toMatchObject([{ anulada: true, pagos_pendientes_ids: [pendiente] }]);
  expect(await mora(ctx.sql, 2)).toBe("3.73");
  expect(await ledger(ctx.sql, 2)).toEqual(["CONDONACION", "ANULACION"]);
  const log = JSON.parse(logs.find((l) => l.includes("anulada_por_pago_pendiente"))!);
  expect(log).toMatchObject({
    mensaje: `Condonación Nexa anulada: el pago pendiente ${pendiente} que la sostenía se anuló`,
    credito_id: 2, pago_id: pendiente, nexa_payment_event_id: 102, monto_restituido: "3.73",
  });
  const [hist] = await ctx.sql`SELECT tipo_evento, motivo FROM cartera.moras_historial
    WHERE credito_id = 2 ORDER BY historial_id DESC LIMIT 1`;
  expect(hist).toMatchObject({ tipo_evento: "INCREMENTO" });
  expect(String(hist!.motivo)).toContain(`el pago pendiente ${pendiente} que la sostenía se anuló`);
});

integrationTest("el pendiente se BORRA (reversePayment): lo mismo, en la transacción de la reversa", async () => {
  const ctx = await setup();
  const pendiente = await condonarConPendiente(ctx, 3);
  const warns = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    // Lo que hace reversePayment dentro de su transacción con un pago pendiente:
    // resetea o borra la fila y llama a la anulación (ver reversePayment.test.ts).
    await ctx.database.db.transaction(async (tx) => {
      await tx.execute(dsql`DELETE FROM cartera.pagos_credito WHERE pago_id = ${pendiente}`);
      expect(await ctx.pagoPendiente.anularCondonacionesNexaPorPagoPendiente({
        credito_id: 3, pago_id: pendiente, accion: "revirtio", dbClient: tx as never,
      })).toHaveLength(1);
    });
    expect(warns.mock.calls.map((c) => String(c[0])).join("\n"))
      .toContain(`el pago pendiente ${pendiente} que la sostenía se revirtió`);
  } finally {
    warns.mockRestore();
  }
  expect(await condonacion(ctx.sql, 3)).toMatchObject([{ anulada: true }]);
  expect(await mora(ctx.sql, 3)).toBe("3.73");
  expect(await ledger(ctx.sql, 3)).toEqual(["CONDONACION", "ANULACION"]);

  // Si la anulación falla, la reversa entera hace rollback (el pago no se borra).
  const otro = await condonarConPendiente(ctx, 7);
  await ctx.sql`ALTER TABLE cartera.mora_pagada_cuota RENAME TO mora_pagada_cuota_fuera`;
  try {
    await expect(ctx.database.db.transaction(async (tx) => {
      await tx.execute(dsql`DELETE FROM cartera.pagos_credito WHERE pago_id = ${otro}`);
      await ctx.pagoPendiente.anularCondonacionesNexaPorPagoPendiente({
        credito_id: 7, pago_id: otro, accion: "revirtio", dbClient: tx as never,
      });
    })).rejects.toThrow();
  } finally {
    await ctx.sql`ALTER TABLE cartera.mora_pagada_cuota_fuera RENAME TO mora_pagada_cuota`;
  }
  expect((await ctx.sql`SELECT 1 FROM cartera.pagos_credito WHERE pago_id = ${otro}`).length).toBe(1);
  expect(await condonacion(ctx.sql, 7)).toMatchObject([{ anulada: false }]);
});

integrationTest("el pendiente se VALIDA: la condonación se queda (y anular después ese pago ya validado no la toca)", async () => {
  const ctx = await setup();
  const pendiente = await condonarConPendiente(ctx, 4);
  await ctx.sql`UPDATE cartera.pagos_credito SET validation_status = 'validated' WHERE pago_id = ${pendiente}`;
  await ctx.sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = 44`;
  // La verificación posterior tampoco ve problema: el crédito sigue al día.
  expect(await condonacion(ctx.sql, 4)).toMatchObject([{ anulada: false }]);
  const logs = await anularPago(ctx, 4, pendiente);
  expect(logs.some((l) => l.includes("anulada_por_pago_pendiente"))).toBe(false);
  expect(await condonacion(ctx.sql, 4)).toMatchObject([{ anulada: false }]);
  expect(await mora(ctx.sql, 4)).toBe("0.00");
});

integrationTest("parcial PENDIENTE que el pago Nexa completaría: sigue sin condonar", async () => {
  const ctx = await setup();
  await credito(ctx.sql, 5, false);
  // Q400 en ventanilla hoy en la cuota 5, pendientes (parcial: pagado=false). Nexa trae los Q600.
  await ctx.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago,
      monto_aplicado, abono_capital, abono_interes, abono_iva_12)
    VALUES (5, 55, 'pending', false, (now() AT TIME ZONE 'America/Guatemala')::date, 400, 0, 300, 100)`;
  expect(await ctx.runtime.condonarMoraNexaATiempo(pagoNexa(ctx.hoy, 5, "600.00"), 105)).toBeUndefined();
  expect(await condonacion(ctx.sql, 5)).toEqual([]);
});

integrationTest("una condonación SIN pendientes no se toca cuando se anula otro pago pendiente del crédito", async () => {
  const ctx = await setup();
  // La cuota 4 está pagada y validada: el "al día" no depende de ningún pendiente.
  await credito(ctx.sql, 6, false);
  expect(await ctx.runtime.condonarMoraNexaATiempo(pagoNexa(ctx.hoy, 6), 106)).toEqual({ monto: "3.73" });
  expect(await condonacion(ctx.sql, 6)).toMatchObject([{ motivo: "NEXA_ACH_A_TIEMPO", pagos_pendientes_ids: null }]);
  // Otro pago pendiente (de la cuota 6, que no venció) se anula.
  const [p] = await ctx.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago, monto_aplicado, mora)
    VALUES (6, 66, 'pending', false, now(), 200, 0) RETURNING pago_id`;
  const logs = await anularPago(ctx, 6, p!.pago_id as number);
  expect(logs.some((l) => l.includes("anulada_por_pago_pendiente"))).toBe(false);
  expect(await condonacion(ctx.sql, 6)).toMatchObject([{ anulada: false }]);
  expect(await mora(ctx.sql, 6)).toBe("0.00");
});

integrationTest("dos parciales PENDIENTES (pagado=false) que suman la cuota vencida no la cubren para el cron: no se condona", async () => {
  const ctx = await setup();
  const fila = await credito(ctx.sql, 8, false);
  // La cuota 4 no la cubre un validado sino dos parciales pendientes de 500, ninguno pagado=true.
  await ctx.sql`UPDATE cartera.pagos_credito SET validation_status = 'pending', pagado = false,
      monto_aplicado = 500, abono_capital = 300, abono_interes = 150, abono_iva_12 = 50 WHERE pago_id = ${fila}`;
  await ctx.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, pagado, fecha_pago,
      monto_aplicado, abono_capital, abono_interes, abono_iva_12, mora)
    VALUES (8, 84, 'pending', false, (now() AT TIME ZONE 'America/Guatemala')::date - 1, 500, 300, 150, 50, 0)`;
  // La cuota 4 venció hace 40 días: para el cron sigue vencida (ningún pendiente pagado=true) y
  // genera su mora con techo de 30 días (112.00) además de los 3.73 de la cuota 5.
  await ctx.sql`UPDATE cartera.cuotas_credito SET fecha_vencimiento = (now() AT TIME ZONE 'America/Guatemala')::date - 40
    WHERE cuota_id = 84`;
  await ctx.sql`UPDATE cartera.moras_credito SET monto_mora = 115.73, cuotas_atrasadas = 2 WHERE credito_id = 8`;
  expect((await ctx.latefee.evaluarCreditoAlDia(8)).cuotasVencidas).toBe(2);
  // Nexa trae la mora legítima (112.00) más la cuota 5. Si los dos parciales contaran, la simulación
  // daría la cuota 4 por cubierta y condonaría los 3.73 con el crédito no al día.
  expect(await ctx.runtime.condonarMoraNexaATiempo(pagoNexa(ctx.hoy, 8, "1112.00"), 108)).toBeUndefined();
  expect(await condonacion(ctx.sql, 8)).toEqual([]);
});
