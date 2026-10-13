import { afterAll, expect } from "bun:test";
import Big from "big.js";
import {
  cerrarEsquemaBoletaTardia, integrationTest, levantarEsquemaBoletaTardia, type Sql,
} from "./boletaTardiaTestDb";
import type { DepsDecisionBoletaTardia } from "./boletaTardiaDecision";

// E-5: la app se importa DENTRO de la prueba, cuando el fixture ya apuntó SUPABASE_DB_URL a la base de pruebas.
const calcularDecisionBoletaTardia: typeof import("./boletaTardiaDecision").calcularDecisionBoletaTardia =
  async (...a) => (await import("./boletaTardiaDecision")).calcularDecisionBoletaTardia(...a);
const vistaPreviaBoletaTardia: typeof import("./boletaTardiaDecision").vistaPreviaBoletaTardia =
  async (...a) => (await import("./boletaTardiaDecision")).vistaPreviaBoletaTardia(...a);

afterAll(cerrarEsquemaBoletaTardia);

const filaDeRelleno = async (sql: Sql, credito: number, cuotas: number[]) => {
  for (const cuota of cuotas) {
    await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado)
      VALUES (${credito}, ${cuota}, 'no_required', 0)`;
  }
};

// Mora a 3 días de la cuota 12 (vence 30-sep), hoy 03-oct, capital 10,000 → 11.20.
async function sembrar(sql: Sql, credito: number, opciones: { status?: string; mora?: string | null; duplicada?: boolean } = {}) {
  await sql`ALTER TABLE cartera.creditos ADD COLUMN IF NOT EXISTS cuota numeric(18,2)`;
  await sql`ALTER TABLE cartera.cuotas_credito ADD COLUMN IF NOT EXISTS numero_cuota integer,
    ADD COLUMN IF NOT EXISTS fecha_vencimiento date, ADD COLUMN IF NOT EXISTS pagado boolean DEFAULT false`;
  await sql`ALTER TABLE cartera.pagos_credito ADD COLUMN IF NOT EXISTS pagado boolean, ADD COLUMN IF NOT EXISTS fecha_pago timestamp`;
  await sql`CREATE TABLE IF NOT EXISTS cartera.ajuste_fecha_ideal_pago (id serial PRIMARY KEY, credito_id integer, monto_total numeric(18,2), fecha_cobro date)`;
  await sql`UPDATE cartera.creditos SET "statusCredit" = ${opciones.status ?? "MOROSO"}, cuota = 1000 WHERE credito_id = ${credito}`;
  await sql`DELETE FROM cartera.pagos_credito WHERE credito_id = ${credito}`;
  await sql`DELETE FROM cartera.cuotas_credito WHERE credito_id = ${credito}`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado) VALUES
    (${credito * 10 + 1}, ${credito}, 11, '2026-08-31', true),
    (${credito * 10 + 2}, ${credito}, 12, '2026-09-30', false),
    (${credito * 10 + 3}, ${credito}, 13, '2026-10-30', false)`;
  // Como en producción: toda cuota abierta trae su fila de relleno en pagos_credito (insertPayment hace INNER JOIN).
  await filaDeRelleno(sql, credito, [credito * 10 + 2, credito * 10 + 3]);
  if (opciones.duplicada) {
    await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
      VALUES (${credito * 10 + 4}, ${credito}, 12, '2026-09-30', false)`;
    await filaDeRelleno(sql, credito, [credito * 10 + 4]);
  }
  const mora = opciones.mora === undefined ? "11.20" : opciones.mora;
  await sql`UPDATE cartera.moras_credito SET monto_mora = ${mora ?? 0}, activa = ${mora !== null} WHERE credito_id = ${credito}`;
}

const depsFalsas = (sql: Sql, credito: number, opciones: { rubros?: string; duplicada?: boolean } = {}): DepsDecisionBoletaTardia => ({
  dbi: undefined as never, // se completa abajo con la base real
  cuotasParaPendiente: async () => new Map([[credito, {
    capital: "10000",
    cuotas: [
      { cuota_id: credito * 10 + 2, diasAtraso: 3, pagado: 0 },
      ...(opciones.duplicada ? [{ cuota_id: credito * 10 + 4, diasAtraso: 3, pagado: 0 }] : []),
    ],
  }]]),
  cobrarRubros: async () => ({ cobros: [], total: new Big(opciones.rubros ?? "0") }),
  hoy: () => new Date(2026, 9, 3), // campos LOCALES = hora de pared de Guatemala, como hoyGuatemala()
});
const conBase = async (sql: Sql, d: DepsDecisionBoletaTardia): Promise<DepsDecisionBoletaTardia> => {
  const { database } = await levantarEsquemaBoletaTardia();
  void sql;
  return { ...d, dbi: database.db };
};
const entrada = (credito: number, extra: Record<string, unknown> = {}) =>
  ({ credito_id: credito, monto_boleta: 1000, fecha_boleta: "2026-09-30", ...extra });

integrationTest("aplica: boleta del vencimiento, pago exacto → condona la mora de la cuota 12", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 21);
  const r = await calcularDecisionBoletaTardia(entrada(21), await conBase(sql, depsFalsas(sql, 21)));
  expect(r).toEqual({
    aplica: true, razon: null, fechaVencimiento: "2026-09-30", fechaBoleta: "2026-09-30", fechaRegistro: "2026-10-03",
    diasRetraso: 3, montoCondonar: "11.20", moraACobrar: "0.00",
    porCuota: [{ cuota_id: 212, numero_cuota: 12, fecha_vencimiento: "2026-09-30", monto: "11.200000" }],
    moraActiva: "11.20",
  });
});

integrationTest("usa el MISMO disponible que insertPayment: boleta − otros − abono directo a capital", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 22);
  const deps = await conBase(sql, depsFalsas(sql, 22));
  expect((await calcularDecisionBoletaTardia(entrada(22, { monto_boleta: 1100, otros: 100 }), deps)).aplica).toBe(true);
  expect((await calcularDecisionBoletaTardia(entrada(22, { monto_boleta: 1000, otros: 100 }), deps)).razon).toBe("no_queda_al_dia");
  expect((await calcularDecisionBoletaTardia(entrada(22, { monto_boleta: 1000, abono_directo_capital: 200 }), deps)).razon).toBe("no_queda_al_dia");
});

integrationTest("a tiempo pero no queda al día: no aplica, con las fechas para el recuadro gris", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 23);
  const r = await calcularDecisionBoletaTardia(entrada(23, { monto_boleta: 500 }), await conBase(sql, depsFalsas(sql, 23)));
  expect(r).toMatchObject({ aplica: false, razon: "no_queda_al_dia", fechaVencimiento: "2026-09-30", diasRetraso: 3, montoCondonar: "0.00", porCuota: [] });
});

integrationTest("los rubros vivos se descuentan antes de las cuotas; si la lectura de rubros falla, la decisión falla", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 24);
  const deps = await conBase(sql, depsFalsas(sql, 24, { rubros: "300" }));
  expect((await calcularDecisionBoletaTardia(entrada(24), deps)).razon).toBe("no_queda_al_dia");
  expect((await calcularDecisionBoletaTardia(entrada(24, { monto_boleta: 1300 }), deps)).aplica).toBe(true);
  const rota = { ...deps, cobrarRubros: async () => { throw new Error("rubros caído"); } };
  await expect(calcularDecisionBoletaTardia(entrada(24), rota)).rejects.toThrow("rubros caído");
});

integrationTest("razones sin escritura: boleta posterior, boleta futura, sin mora, convenio, sin crédito, cuota duplicada", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 25);
  const deps = await conBase(sql, depsFalsas(sql, 25));
  expect((await calcularDecisionBoletaTardia(entrada(25, { fecha_boleta: "2026-10-01" }), deps)).razon).toBe("fuera_de_ventana");
  expect((await calcularDecisionBoletaTardia(entrada(25, { fecha_boleta: "2026-10-04" }), deps)).razon).toBe("boleta_invalida");
  expect((await calcularDecisionBoletaTardia(entrada(25, { fecha_boleta: "basura" }), deps)).razon).toBe("boleta_invalida");

  await sembrar(sql, 26, { mora: null });
  expect((await calcularDecisionBoletaTardia(entrada(26), await conBase(sql, depsFalsas(sql, 26)))).razon).toBe("sin_mora");

  await sembrar(sql, 27, { status: "EN_CONVENIO" });
  expect((await calcularDecisionBoletaTardia(entrada(27), await conBase(sql, depsFalsas(sql, 27)))).razon).toBe("estado_no_aplica");

  expect((await calcularDecisionBoletaTardia(entrada(9999), await conBase(sql, depsFalsas(sql, 9999)))).razon).toBe("credito_no_encontrado");

  await sembrar(sql, 28, { duplicada: true, mora: "22.40" });
  expect((await calcularDecisionBoletaTardia(entrada(28), await conBase(sql, depsFalsas(sql, 28, { duplicada: true })))).razon).toBe("no_queda_al_dia");

  // Sin escritura: ni condonaciones ni cambios de mora.
  const [{ n: moraTocada }] = await sql`SELECT count(*)::int AS n FROM cartera.moras_credito
    WHERE credito_id IN (21, 25, 28) AND (activa IS NOT TRUE OR monto_mora NOT IN (11.20, 22.40))`;
  expect(moraTocada).toBe(0);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id BETWEEN 21 AND 28`;
  expect(n).toBe(0);
});

integrationTest("vistaPreviaBoletaTardia: intentoId UUID nuevo en cada llamada y sin moraActiva", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 29);
  const deps = await conBase(sql, depsFalsas(sql, 29));
  const a = await vistaPreviaBoletaTardia(entrada(29), deps);
  const b = await vistaPreviaBoletaTardia(entrada(29), deps);
  expect(a.intentoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a.intentoId).not.toBe(b.intentoId);
  expect("moraActiva" in a).toBe(false);
  expect(a.aplica).toBe(true);
});

integrationTest("cuota 1: la previa es la cuota 0 (desembolso); una boleta anterior al desembolso no califica", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 30);
  await sql`DELETE FROM cartera.cuotas_credito WHERE credito_id = 30`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado) VALUES
    (301, 30, 0, '2026-09-15', true), (302, 30, 1, '2026-09-30', false)`;
  const base = depsFalsas(sql, 30);
  const deps = await conBase(sql, { ...base, cuotasParaPendiente: async () => new Map([[30, { capital: "10000", cuotas: [{ cuota_id: 302, diasAtraso: 3, pagado: 0 }] }]]) });
  expect((await calcularDecisionBoletaTardia(entrada(30), deps)).aplica).toBe(true);
  expect((await calcularDecisionBoletaTardia(entrada(30, { fecha_boleta: "2026-09-10" }), deps)).razon).toBe("boleta_de_otro_periodo");
});

integrationTest("cuota 1 sin cuota 0 (crédito sin fecha de desembolso): la previa null se tolera", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 31);
  await sql`DELETE FROM cartera.pagos_credito WHERE credito_id = 31`;
  await sql`DELETE FROM cartera.cuotas_credito WHERE credito_id = 31`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
    VALUES (311, 31, 1, '2026-09-30', false)`;
  await filaDeRelleno(sql, 31, [311]);
  const deps = await conBase(sql, { ...depsFalsas(sql, 31), cuotasParaPendiente: async () => new Map([[31, { capital: "10000", cuotas: [{ cuota_id: 311, diasAtraso: 3, pagado: 0 }] }]]) });
  expect((await calcularDecisionBoletaTardia(entrada(31), deps)).aplica).toBe(true);
});

integrationTest("F3a: una cuota 0 abierta no cuenta como cuota abierta (insertPayment usa numero_cuota >= 1)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 32);
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
    VALUES (320, 32, 0, '2026-07-15', false)`;
  await filaDeRelleno(sql, 32, [320]);
  const r = await calcularDecisionBoletaTardia(entrada(32), await conBase(sql, depsFalsas(sql, 32)));
  expect(r.aplica).toBe(true);
});

integrationTest("F3b: cuota vencida abierta sin ninguna fila en pagos_credito => no_queda_al_dia (insertPayment no la pagaría)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 33);
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
    VALUES (339, 33, 10, '2026-07-31', false)`;
  const r = await calcularDecisionBoletaTardia(entrada(33, { monto_boleta: 5000 }), await conBase(sql, depsFalsas(sql, 33)));
  expect(r).toMatchObject({ aplica: false, razon: "no_queda_al_dia" });
});

integrationTest("F1: montos negativos o no numéricos hacen LANZAR a la decisión (no la dejan 'aplicar')", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sembrar(sql, 34);
  const deps = await conBase(sql, depsFalsas(sql, 34));
  await expect(calcularDecisionBoletaTardia(entrada(34, { monto_boleta: 500, otros: -600 }), deps)).rejects.toThrow(/inválid/i);
  await expect(calcularDecisionBoletaTardia(entrada(34, { abono_directo_capital: -1 }), deps)).rejects.toThrow(/inválid/i);
  await expect(calcularDecisionBoletaTardia(entrada(34, { monto_boleta: "abc" }), deps)).rejects.toThrow(/inválid/i);
  await expect(calcularDecisionBoletaTardia(entrada(34, { monto_boleta: -5 }), deps)).rejects.toThrow(/inválid/i);
  await expect(calcularDecisionBoletaTardia(entrada(0), deps)).rejects.toThrow(/inválid/i);
});
