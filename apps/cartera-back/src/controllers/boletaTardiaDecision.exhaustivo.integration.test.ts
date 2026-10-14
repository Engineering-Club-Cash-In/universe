import { afterAll, expect } from "bun:test";
import Big from "big.js";
import {
  cerrarEsquemaBoletaTardia, integrationTest, levantarEsquemaBoletaTardia, type Sql,
} from "./boletaTardiaTestDb";
import type { DepsDecisionBoletaTardia, EntradaBoletaTardia } from "./boletaTardiaDecision";

/**
 * Pruebas exhaustivas (caja negra) de la Tarea 5: `calcularDecisionBoletaTardia` / `vistaPreviaBoletaTardia`.
 * Derivadas de la spec §2 y §4.2, no de la implementación. `hoy` = 03-oct-2026, capital 10,000 (mora diaria 3.7333),
 * cuota mensual 1,000. Usa el `cuotasParaPendienteDeCreditos` REAL (lee la base) y solo fakea los rubros.
 */
afterAll(cerrarEsquemaBoletaTardia);

const HOY = new Date(2026, 9, 3); // campos LOCALES = hora de pared de Guatemala (como hoyGuatemala())
const calcular = async (e: EntradaBoletaTardia, d: DepsDecisionBoletaTardia) =>
  (await import("./boletaTardiaDecision")).calcularDecisionBoletaTardia(e, d);
const previa = async (e: EntradaBoletaTardia, d: DepsDecisionBoletaTardia) =>
  (await import("./boletaTardiaDecision")).vistaPreviaBoletaTardia(e, d);

type CuotaSeed = { n: number; venc: string; pagado?: boolean; id?: number; sinFila?: boolean };
type Seed = { status?: string | null; mora?: string | null; moraActiva?: boolean; cuotas: CuotaSeed[]; capital?: number };

let esquemaListo = false;
async function preparar(sql: Sql) {
  if (esquemaListo) return;
  await sql`ALTER TABLE cartera.creditos ADD COLUMN IF NOT EXISTS cuota numeric(18,2)`;
  await sql`ALTER TABLE cartera.cuotas_credito ADD COLUMN IF NOT EXISTS numero_cuota integer`;
  await sql`ALTER TABLE cartera.pagos_credito ADD COLUMN IF NOT EXISTS pagado boolean, ADD COLUMN IF NOT EXISTS fecha_pago timestamp`;
  await sql`CREATE TABLE IF NOT EXISTS cartera.ajuste_fecha_ideal_pago (id serial PRIMARY KEY, credito_id integer, monto_total numeric(18,2), fecha_cobro date)`;
  esquemaListo = true;
}

let siguiente = 100;
/** Crea un crédito nuevo (id propio por prueba) con sus cuotas y su mora; devuelve el id. */
async function sembrar(sql: Sql, seed: Seed): Promise<number> {
  await preparar(sql);
  const id = ++siguiente;
  await sql`INSERT INTO cartera.creditos (credito_id, numero_credito_sifco, "statusCredit", capital, cuota)
    VALUES (${id}, ${`BT-${id}`}, ${seed.status === undefined ? "MOROSO" : seed.status}, ${seed.capital ?? 10000}, 1000)`;
  for (const c of seed.cuotas) {
    await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, numero_cuota, fecha_vencimiento, pagado)
      VALUES (${c.id ?? id * 100 + c.n}, ${id}, ${c.n}, ${c.venc}, ${c.pagado ?? false})`;
    // Como en producción: toda cuota abierta trae su fila de relleno (insertPayment hace INNER JOIN con pagos_credito).
    if (!c.pagado && c.n >= 1 && !c.sinFila) {
      await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado)
        VALUES (${id}, ${c.id ?? id * 100 + c.n}, 'no_required', 0)`;
    }
  }
  if (seed.mora !== undefined) {
    await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, activa, cuotas_atrasadas)
      VALUES (${id}, ${seed.mora ?? 0}, ${seed.moraActiva ?? seed.mora !== null}, 1)`;
  }
  return id;
}
const cuotaId = (credito: number, n: number) => credito * 100 + n;

/** Cuotas típicas: 11 pagada (31-ago), 12 vencida (30-sep, 3 días), 13 futura (30-oct). */
const tipicas: CuotaSeed[] = [
  { n: 11, venc: "2026-08-31", pagado: true }, { n: 12, venc: "2026-09-30" }, { n: 13, venc: "2026-10-30" },
];
/** mora devengada de una cuota con `dias` de atraso, capital 10,000: capital × 0.0112 × min(1, dias/30). */
const devengado = (dias: number, capital = 10000) => new Big(capital).times("0.0112").times(Math.min(1, dias / 30));

type Espia = { llamadas: { credito_id: number; disponible: unknown }[] };
async function deps(extra: { rubros?: string; rota?: boolean; espia?: Espia; hoy?: Date } = {}): Promise<DepsDecisionBoletaTardia> {
  const { database, latefee } = await levantarEsquemaBoletaTardia();
  return {
    dbi: database.db,
    cuotasParaPendiente: latefee.cuotasParaPendienteDeCreditos,
    cobrarRubros: async (a: any) => {
      extra.espia?.llamadas.push({ credito_id: a.credito_id, disponible: a.disponible });
      if (extra.rota) throw new Error("rubros caído");
      return { cobros: [], total: new Big(extra.rubros ?? "0") };
    },
    hoy: () => extra.hoy ?? HOY,
  };
}
const ent = (credito: number, extra: Record<string, unknown> = {}): EntradaBoletaTardia =>
  ({ credito_id: credito, monto_boleta: 1000, fecha_boleta: "2026-09-30", ...extra }) as EntradaBoletaTardia;

const TABLAS = ["moras_credito", "moras_condonaciones", "mora_pagada_cuota", "moras_historial", "pagos_credito"] as const;
async function huella(sql: Sql) {
  const out: Record<string, string> = {};
  for (const t of TABLAS) {
    const [r] = await sql.unsafe(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM cartera.${t} x`);
    out[t] = `${r!.n}:${r!.h}`;
  }
  return out;
}

integrationTest("crédito inexistente → credito_no_encontrado, sin nada", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await preparar(sql);
  const r = await calcular(ent(999_999), await deps());
  expect(r).toEqual({
    aplica: false, razon: "credito_no_encontrado", fechaVencimiento: null, fechaBoleta: "2026-09-30", fechaRegistro: "2026-10-03",
    diasRetraso: null, montoCondonar: "0.00", moraACobrar: "0.00", porCuota: [], moraActiva: null,
  });
});

integrationTest("estados que no devengan mora no aplican: EN_CONVENIO, INCOBRABLE, CANCELADO, PENDIENTE_CANCELACION, null", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  for (const status of ["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION", "CAIDO", null]) {
    const id = await sembrar(sql, { status, mora: "11.20", cuotas: tipicas });
    const r = await calcular(ent(id, { monto_boleta: 5000 }), await deps());
    expect([status, r.aplica, r.razon, r.montoCondonar, r.porCuota]).toEqual([status, false, "estado_no_aplica", "0.00", []]);
  }
  // Control: ACTIVO y MOROSO sí.
  for (const status of ["ACTIVO", "MOROSO"]) {
    const id = await sembrar(sql, { status, mora: "11.20", cuotas: tipicas });
    const r = await calcular(ent(id), await deps());
    expect([status, r.aplica, r.montoCondonar]).toEqual([status, true, "11.20"]);
  }
});

integrationTest("sin mora activa (sin fila, apagada, en 0) → sin_mora; ni siquiera lee rubros", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const espia: Espia = { llamadas: [] };
  const sinFila = await sembrar(sql, { cuotas: tipicas });
  const apagada = await sembrar(sql, { mora: "11.20", moraActiva: false, cuotas: tipicas });
  const enCero = await sembrar(sql, { mora: "0", cuotas: tipicas });
  for (const id of [sinFila, apagada, enCero]) {
    const r = await calcular(ent(id), await deps({ espia }));
    expect([id, r.aplica, r.razon, r.montoCondonar, r.porCuota]).toEqual([id, false, "sin_mora", "0.00", []]);
  }
  expect((await calcular(ent(sinFila), await deps())).moraActiva).toBeNull();
  expect(espia.llamadas).toEqual([]);
});

integrationTest("cuotas duplicadas por numero_cuota (la de mora es la vieja) → no aplica; si la duplicada está pagada, sí", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  // Dos filas impagas de la cuota 12: insertPayment solo paga la de mayor cuota_id; la otra queda con mora → no queda al día.
  const dup = await sembrar(sql, { mora: "22.40", cuotas: [...tipicas, { n: 12, venc: "2026-09-30", id: 99_999_001 }] });
  const r = await calcular(ent(dup, { monto_boleta: 9000 }), await deps());
  expect([r.aplica, r.razon, r.montoCondonar]).toEqual([false, "no_queda_al_dia", "0.00"]);
  // Control: la gemela está pagada → no estorba.
  const ok = await sembrar(sql, { mora: "11.20", cuotas: [...tipicas, { n: 12, venc: "2026-09-30", pagado: true, id: 99_999_002 }] });
  const r2 = await calcular(ent(ok), await deps());
  expect([r2.aplica, r2.montoCondonar]).toEqual([true, "11.20"]);
});

integrationTest("pago PENDIENTE vigente que hace falta para quedar al día → no condona; fuera de ventana o parcial no cuentan como cobertura", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const pagoPendiente = (credito: number, cuota: number, o: { abono: number; pagado: boolean; fecha: string; status?: string; falso?: boolean }) =>
    sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado, abono_capital, pagado, fecha_pago, "paymentFalse")
      VALUES (${credito}, ${cuota}, ${o.status ?? "pending"}, ${o.abono}, ${o.abono}, ${o.pagado}, ${o.fecha}, ${o.falso ?? false})`;

  // a) pendiente pagado=true de hace 2 días, cubre toda la cuota 12: el cron la da por cubierta, pero la boleta no se apoya en pendientes.
  const a = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  await pagoPendiente(a, cuotaId(a, 12), { abono: 1000, pagado: true, fecha: "2026-10-01" });
  const ra = await calcular(ent(a, { monto_boleta: 1000 }), await deps());
  expect([ra.aplica, ra.razon]).toEqual([false, "no_queda_al_dia"]);

  // b) pendiente parcial (400) pagado=true de ayer + boleta que completa 600: la cuota se completaría pero su cierre queda diferido.
  const b = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  await pagoPendiente(b, cuotaId(b, 12), { abono: 400, pagado: true, fecha: "2026-10-02" });
  const rb = await calcular(ent(b, { monto_boleta: 600 }), await deps());
  expect([rb.aplica, rb.razon]).toEqual([false, "no_queda_al_dia"]);

  // c) pendiente de hace 20 días (fuera de la ventana de 7): ya no cubre la cuota (debe 1000 completa), pero el pendiente con plata
  //    sigue difiriendo el cierre de la cuota (criterio heredado de Nexa) → conservador: no condona.
  const c = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  await pagoPendiente(c, cuotaId(c, 12), { abono: 1000, pagado: true, fecha: "2026-09-13" });
  const rc = await calcular(ent(c, { monto_boleta: 1000 }), await deps());
  expect([rc.aplica, rc.razon]).toEqual([false, "no_queda_al_dia"]);

  // d) pendiente pagado=false (el cron lo ignora) → no cubre; boleta 1000 aplica (pero sigue habiendo pago vivo con plata: cierreDiferido).
  const d = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  await pagoPendiente(d, cuotaId(d, 12), { abono: 1000, pagado: false, fecha: "2026-10-01" });
  const rd = await calcular(ent(d, { monto_boleta: 1000 }), await deps());
  // El pendiente con plata difiere el cierre de la cuota aunque el cron no lo cuente: el crédito no queda al día con este pago.
  expect([rd.aplica, rd.razon]).toEqual([false, "no_queda_al_dia"]);

  // e) pendiente ANULADO (paymentFalse=true): no existe.
  const e = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  await pagoPendiente(e, cuotaId(e, 12), { abono: 1000, pagado: true, fecha: "2026-10-01", falso: true });
  const re = await calcular(ent(e, { monto_boleta: 1000 }), await deps());
  expect([re.aplica, re.montoCondonar]).toEqual([true, "11.20"]);

  // f) pago VALIDADO parcial de 400: saldo 600; boleta 600 aplica, 599.99 aplica (tolerancia 0.01), 599.98 no.
  const f = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  await pagoPendiente(f, cuotaId(f, 12), { abono: 400, pagado: false, fecha: "2026-09-25", status: "validated" });
  expect((await calcular(ent(f, { monto_boleta: 600 }), await deps())).aplica).toBe(true);
  expect((await calcular(ent(f, { monto_boleta: "599.99" }), await deps())).aplica).toBe(true);
  expect((await calcular(ent(f, { monto_boleta: "599.98" }), await deps())).razon).toBe("no_queda_al_dia");
});

integrationTest("rubros activos consumen la boleta antes de las cuotas; el disponible que reciben es el de insertPayment", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  expect((await calcular(ent(id, { monto_boleta: 1000 }), await deps({ rubros: "300" }))).razon).toBe("no_queda_al_dia");
  expect((await calcular(ent(id, { monto_boleta: 1300 }), await deps({ rubros: "300" }))).aplica).toBe(true);
  // Borde de la tolerancia: 0.01 de faltante queda al día, 0.02 no.
  expect((await calcular(ent(id, { monto_boleta: 1000 }), await deps({ rubros: "0.01" }))).aplica).toBe(true);
  expect((await calcular(ent(id, { monto_boleta: 1000 }), await deps({ rubros: "0.02" }))).razon).toBe("no_queda_al_dia");
  // Rubros más grandes que la boleta: no explota ni condona.
  expect((await calcular(ent(id, { monto_boleta: 100 }), await deps({ rubros: "9999" }))).razon).toBe("no_queda_al_dia");
  // Disponible entregado a los rubros = boleta − otros − abono directo, nunca negativo.
  const espia: Espia = { llamadas: [] };
  await calcular(ent(id, { monto_boleta: 1500, otros: 100, abono_directo_capital: 200 }), await deps({ espia }));
  await calcular(ent(id, { monto_boleta: 100, otros: 300 }), await deps({ espia }));
  await calcular(ent(id, { monto_boleta: "1000.50" }), await deps({ espia }));
  expect(espia.llamadas.map((l) => [l.credito_id, new Big(l.disponible as any).toFixed(2)])).toEqual([
    [id, "1200.00"], [id, "0.00"], [id, "1000.50"],
  ]);
  // Si la lectura de rubros falla, la decisión falla (no sub-cuenta rubros).
  await expect(calcular(ent(id), await deps({ rota: true }))).rejects.toThrow("rubros caído");
});

integrationTest("abono_directo_capital y otros dejan el disponible corto; el borde es 0.01", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const dd = await deps();
  const c = (extra: Record<string, unknown>) => calcular(ent(id, extra), dd);
  expect((await c({ monto_boleta: 1000, abono_directo_capital: 1 })).razon).toBe("no_queda_al_dia");
  expect((await c({ monto_boleta: 1000, abono_directo_capital: 0.02 })).razon).toBe("no_queda_al_dia");
  expect((await c({ monto_boleta: 1000, abono_directo_capital: 0.01 })).aplica).toBe(true);
  expect((await c({ monto_boleta: 1100, abono_directo_capital: 100 })).aplica).toBe(true);
  expect((await c({ monto_boleta: 1100, otros: 100 })).aplica).toBe(true);
  expect((await c({ monto_boleta: 1100, otros: 60, abono_directo_capital: 40 })).aplica).toBe(true);
  expect((await c({ monto_boleta: 1099, otros: 60, abono_directo_capital: 40 })).razon).toBe("no_queda_al_dia");
  // null/undefined equivalen a 0.
  expect((await c({ monto_boleta: 1000, otros: null, abono_directo_capital: null })).aplica).toBe(true);
  // otros o abono mayores que la boleta: disponible 0, jamás negativo (no "regala" nada).
  expect((await c({ monto_boleta: 100, otros: 500 })).razon).toBe("no_queda_al_dia");
  expect((await c({ monto_boleta: 0 })).razon).toBe("no_queda_al_dia");
  // monto como string con decimales.
  expect((await c({ monto_boleta: "1000.00" })).aplica).toBe(true);
});

integrationTest("entradas inválidas LANZAN (nunca 'aplican'): montos negativos, no numéricos, string sin 2 decimales, NaN/Infinity, crédito 0/1.5/negativo", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const dd = await deps();
  const malas: Record<string, unknown>[] = [
    { monto_boleta: -50 }, { monto_boleta: "abc" }, { monto_boleta: "1000" }, { monto_boleta: "1000.5" }, { monto_boleta: "-10.00" },
    { monto_boleta: "" }, { monto_boleta: Number.NaN }, { monto_boleta: Number.POSITIVE_INFINITY }, { monto_boleta: null }, { monto_boleta: undefined },
    { monto_boleta: 1000, otros: -1 }, { monto_boleta: 500, otros: -600 }, { monto_boleta: 1000, abono_directo_capital: -1 },
    { monto_boleta: 1000, otros: Number.NaN }, { monto_boleta: 1000, abono_directo_capital: Number.POSITIVE_INFINITY },
    { monto_boleta: 1000, otros: "5" }, { credito_id: 0 }, { credito_id: -3 }, { credito_id: 1.5 }, { credito_id: "5" }, { credito_id: null },
  ];
  for (const extra of malas) {
    await expect(calcular(ent(id, extra), dd)).rejects.toThrow(/inválid/i);
    await expect(previa(ent(id, extra), dd)).rejects.toThrow(/inválid/i);
  }
  // Y lanzan ANTES de leer nada: los rubros no se consultaron.
  const espia: Espia = { llamadas: [] };
  await expect(calcular(ent(id, { monto_boleta: -1 }), await deps({ espia }))).rejects.toThrow(/inválid/i);
  expect(espia.llamadas).toEqual([]);
  // Válidas en el borde: 0, 0.00, otros 0, abono 0.
  for (const extra of [{ monto_boleta: 0 }, { monto_boleta: "0.00" }, { monto_boleta: 1000, otros: 0, abono_directo_capital: 0 }]) {
    await calcular(ent(id, extra), dd);
  }
});

integrationTest("cuota vencida abierta SIN fila en pagos_credito: insertPayment no la paga → no_queda_al_dia (aunque el monto alcance)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const dd = await deps();
  // La cuota en ventana sin fila.
  const a = await sembrar(sql, { mora: "11.20", cuotas: [
    { n: 11, venc: "2026-08-31", pagado: true }, { n: 12, venc: "2026-09-30", sinFila: true }, { n: 13, venc: "2026-10-30" }] });
  const ra = await calcular(ent(a, { monto_boleta: 9000 }), dd);
  expect([ra.aplica, ra.razon, ra.montoCondonar]).toEqual([false, "no_queda_al_dia", "0.00"]);
  // Otra cuota vencida vieja sin fila (mora legítima aparte) tampoco deja al día.
  const b = await sembrar(sql, { mora: "123.20", cuotas: [
    { n: 9, venc: "2026-07-31", sinFila: true }, { n: 11, venc: "2026-08-31", pagado: true }, { n: 12, venc: "2026-09-30" }] });
  expect((await calcular(ent(b, { monto_boleta: 9000 }), dd)).razon).toBe("no_queda_al_dia");
  // Una cuota FUTURA sin fila no estorba (no está vencida).
  const c = await sembrar(sql, { mora: "11.20", cuotas: [
    { n: 11, venc: "2026-08-31", pagado: true }, { n: 12, venc: "2026-09-30" }, { n: 13, venc: "2026-10-30", sinFila: true }] });
  expect((await calcular(ent(c), dd)).aplica).toBe(true);
});

integrationTest("una cuota 0 abierta (desembolso) no cuenta como cuota abierta ni estorba", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: [...tipicas, { n: 0, venc: "2026-07-15" }] });
  const r = await calcular(ent(id), await deps());
  expect([r.aplica, r.montoCondonar]).toEqual([true, "11.20"]);
});

integrationTest("cuota 1: con cuota 0 (desembolso) la boleta debe ser posterior; sin cuota 0 se tolera; cuota >1 sin previa no califica", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const base = (extra: CuotaSeed[]) => sembrar(sql, { mora: "11.20", cuotas: [{ n: 1, venc: "2026-09-30" }, ...extra] });
  const dd = await deps();
  // Con cuota 0 del 15-sep (feriado en GT: su límite hábil es el 16-sep). PR 19: la boleta debe ser posterior al
  // LÍMITE hábil de la previa, no a su fecha: el 16-sep ya no califica, el 17-sep sí.
  const con0 = await base([{ n: 0, venc: "2026-09-15", pagado: true }]);
  expect((await calcular(ent(con0, { fecha_boleta: "2026-09-17" }), dd)).aplica).toBe(true);
  expect((await calcular(ent(con0, { fecha_boleta: "2026-09-16" }), dd)).razon).toBe("boleta_de_otro_periodo"); // = límite hábil del desembolso
  expect((await calcular(ent(con0, { fecha_boleta: "2026-09-15" }), dd)).razon).toBe("boleta_de_otro_periodo"); // igual al desembolso: no es posterior
  expect((await calcular(ent(con0, { fecha_boleta: "2026-09-14" }), dd)).razon).toBe("boleta_de_otro_periodo");
  expect((await calcular(ent(con0, { fecha_boleta: "2026-08-01" }), dd)).razon).toBe("boleta_de_otro_periodo");
  // Sin cuota 0: cualquier boleta ≤ vencimiento califica (no hay fecha de desembolso que comparar).
  const sin0 = await base([]);
  expect((await calcular(ent(sin0, { fecha_boleta: "2026-09-30" }), dd)).aplica).toBe(true);
  expect((await calcular(ent(sin0, { fecha_boleta: "2026-08-01" }), dd)).aplica).toBe(true);
  // Cuota 2 cuya cuota 1 no existe en la tabla: no es "cuota 1", no califica.
  const huerfana = await sembrar(sql, { mora: "11.20", cuotas: [{ n: 2, venc: "2026-09-30" }] });
  expect((await calcular(ent(huerfana), dd)).razon).toBe("boleta_de_otro_periodo");
});

integrationTest("control anti boleta vieja: la boleta debe ser ESTRICTAMENTE posterior al vencimiento de la cuota anterior", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas }); // previa de la 12 = 31-ago
  const dd = await deps();
  expect((await calcular(ent(id, { fecha_boleta: "2026-09-01" }), dd)).aplica).toBe(true);
  expect((await calcular(ent(id, { fecha_boleta: "2026-08-31" }), dd)).razon).toBe("boleta_de_otro_periodo");
  expect((await calcular(ent(id, { fecha_boleta: "2026-08-30" }), dd)).razon).toBe("boleta_de_otro_periodo");
  expect((await calcular(ent(id, { fecha_boleta: "2025-01-01" }), dd)).razon).toBe("boleta_de_otro_periodo");
  // La previa es la cuota N−1 aunque esté impaga/ordenada distinto: cuota 11 impaga vence 25-sep → boleta 25-sep no es del período.
  const impaga = await sembrar(sql, { mora: "11.20", cuotas: [
    { n: 11, venc: "2026-09-25", pagado: true }, { n: 12, venc: "2026-09-30" }, { n: 13, venc: "2026-10-30" }] });
  expect((await calcular(ent(impaga, { fecha_boleta: "2026-09-25" }), dd)).razon).toBe("boleta_de_otro_periodo");
  expect((await calcular(ent(impaga, { fecha_boleta: "2026-09-26" }), dd)).aplica).toBe(true);
});

integrationTest("tope por cuota: 5 días entra, 6 no (el tope acota también el monto)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const dd = await deps();
  const con = (venc: string, mora: string) =>
    sembrar(sql, { mora, cuotas: [{ n: 11, venc: "2026-08-01", pagado: true }, { n: 12, venc }, { n: 13, venc: "2026-10-30" }] });
  const d5 = await con("2026-09-28", devengado(5).round(2, Big.roundUp).toFixed(2)); // 18.67
  const r5 = await calcular(ent(d5, { fecha_boleta: "2026-09-28" }), dd);
  expect(r5).toMatchObject({ aplica: true, diasRetraso: 5, fechaVencimiento: "2026-09-28", montoCondonar: "18.67", moraACobrar: "0.00" });
  expect(r5.porCuota).toEqual([{ cuota_id: cuotaId(d5, 12), numero_cuota: 12, fecha_vencimiento: "2026-09-28", monto: devengado(5).toFixed(6) }]);
  const d6 = await con("2026-09-27", devengado(6).toFixed(2)); // 22.40
  const r6 = await calcular(ent(d6, { fecha_boleta: "2026-09-27" }), dd);
  expect([r6.aplica, r6.razon, r6.montoCondonar, r6.porCuota]).toEqual([false, "fuera_de_tope", "0.00", []]);
  const d1 = await con("2026-10-02", devengado(1).round(2, Big.roundUp).toFixed(2)); // 1 día
  expect((await calcular(ent(d1, { fecha_boleta: "2026-10-02" }), dd))).toMatchObject({ aplica: true, diasRetraso: 1 });
  // Mismo vencimiento visto un día después (hoy = 04-oct): el que tenía 5 pasa a 6.
  const r5mañana = await calcular(ent(d5, { fecha_boleta: "2026-09-28" }), await deps({ hoy: new Date(2026, 9, 4) }));
  expect([r5mañana.aplica, r5mañana.razon, r5mañana.fechaRegistro]).toEqual([false, "fuera_de_tope", "2026-10-04"]);
});

integrationTest("tope POR CUOTA: la cuota de 13 días es mora legítima (se cobra), la de 3 se condona", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const legit = devengado(13); // 48.5333
  const retraso = devengado(3); // 11.20
  const moraTotal = legit.plus(retraso).round(2, Big.roundHalfUp); // 59.73
  const id = await sembrar(sql, { mora: moraTotal.toFixed(2), cuotas: [
    { n: 10, venc: "2026-07-31", pagado: true }, { n: 11, venc: "2026-09-20" }, { n: 12, venc: "2026-09-30" }, { n: 13, venc: "2026-10-30" }] });
  const dd = await deps();
  const cobrar = moraTotal.minus(retraso.round(2, Big.roundDown)); // 48.53
  const total = cobrar.plus(2000); // mora legítima + cuotas 11 y 12
  const r = await calcular(ent(id, { monto_boleta: total.toFixed(2) }), dd);
  expect(r).toMatchObject({ aplica: true, montoCondonar: "11.20", moraACobrar: cobrar.toFixed(2), fechaVencimiento: "2026-09-30", diasRetraso: 3 });
  expect(r.porCuota).toEqual([{ cuota_id: cuotaId(id, 12), numero_cuota: 12, fecha_vencimiento: "2026-09-30", monto: "11.200000" }]);
  // Sin alcanzar la mora legítima: no_alcanza_mora, con las fechas de lo que calificaba.
  const corto = await calcular(ent(id, { monto_boleta: cobrar.minus("0.01").toFixed(2) }), dd);
  expect(corto).toMatchObject({ aplica: false, razon: "no_alcanza_mora", fechaVencimiento: "2026-09-30", diasRetraso: 3, montoCondonar: "0.00", porCuota: [] });
  // Alcanza la mora pero no las cuotas: 1 centavo corto pasa por tolerancia; 2 centavos no.
  expect((await calcular(ent(id, { monto_boleta: total.minus("0.01").toFixed(2) }), dd)).aplica).toBe(true);
  expect((await calcular(ent(id, { monto_boleta: total.minus("0.02").toFixed(2) }), dd)).razon).toBe("no_queda_al_dia");
  // La cuota previa de la 12 vence el 20-sep (domingo): su límite hábil es el lunes 21-sep (PR 19). Las boletas del
  // 20 y del 21 no son de este período; del 22-sep en adelante sí.
  const r20 = await calcular(ent(id, { fecha_boleta: "2026-09-20", monto_boleta: total.toFixed(2) }), dd);
  expect([r20.aplica, r20.razon]).toEqual([false, "boleta_de_otro_periodo"]);
  const r21 = await calcular(ent(id, { fecha_boleta: "2026-09-21", monto_boleta: total.toFixed(2) }), dd);
  expect([r21.aplica, r21.razon]).toEqual([false, "boleta_de_otro_periodo"]);
  const r22 = await calcular(ent(id, { fecha_boleta: "2026-09-22", monto_boleta: total.toFixed(2) }), dd);
  expect(r22.aplica).toBe(true);
  expect(r22.porCuota.map((c) => c.numero_cuota)).toEqual([12]);
});

integrationTest("fecha_boleta inválida o futura → boleta_invalida, y se devuelve tal cual vino", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const dd = await deps();
  const malas: unknown[] = ["2026-02-30", "2026-13-01", "2026-10-04", "2027-01-01", "30/09/2026", "", "2026-9-30", "2026-09-30T00:00:00Z",
    "basura", " 2026-09-30", "2026-09-3", 20260930, null, undefined];
  for (const f of malas) {
    const r = await calcular(ent(id, { fecha_boleta: f }), dd);
    expect([f, r.aplica, r.razon, r.montoCondonar, r.porCuota]).toEqual([f, false, "boleta_invalida", "0.00", []]);
    expect(r.fechaBoleta).toBe(f as never);
  }
  // Hoy mismo es válida (pero ninguna cuota vence después de hoy con mora → fuera_de_ventana); 29-feb de año no bisiesto es inválida.
  expect((await calcular(ent(id, { fecha_boleta: "2026-10-03" }), dd)).razon).toBe("fuera_de_ventana");
  expect((await calcular(ent(id, { fecha_boleta: "2026-02-29" }), dd)).razon).toBe("boleta_invalida");
  // Medianoche/mediodía de Guatemala no mueven la fecha de registro.
  for (const h of [new Date(2026, 9, 3, 0, 0, 0), new Date(2026, 9, 3, 23, 59, 59)]) {
    const r = await calcular(ent(id), await deps({ hoy: h }));
    expect([r.fechaRegistro, r.diasRetraso, r.aplica]).toEqual(["2026-10-03", 3, true]);
  }
});

integrationTest("boleta posterior al vencimiento (o igual a hoy) → fuera_de_ventana; un día después del vencimiento ya no es 'a tiempo'", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const dd = await deps();
  for (const f of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
    const r = await calcular(ent(id, { fecha_boleta: f, monto_boleta: 5000 }), dd);
    expect([f, r.aplica, r.razon]).toEqual([f, false, "fuera_de_ventana"]);
  }
  expect((await calcular(ent(id, { fecha_boleta: "2026-09-30" }), dd)).aplica).toBe(true); // borde: igual al vencimiento
});

integrationTest("2 cuotas en ventana + 1 legítima: condona las dos, cobra la legítima; el reparto suma lo condonado", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const legit = devengado(33); // 112.00 (≥30 días → un mes completo)
  const v11 = devengado(4); // 14.9333
  const v12 = devengado(3); // 11.20
  const moraTotal = legit.plus(v11).plus(v12).round(2, Big.roundHalfUp); // 138.13
  const id = await sembrar(sql, { mora: moraTotal.toFixed(2), cuotas: [
    { n: 9, venc: "2026-07-01", pagado: true }, { n: 10, venc: "2026-08-31" }, { n: 11, venc: "2026-09-29" },
    { n: 12, venc: "2026-09-30" }, { n: 13, venc: "2026-10-30" }] });
  const dd = await deps();
  const condonar = moraTotal.minus(legit.round(2, Big.roundHalfUp)); // 26.13
  const monto = legit.round(2).plus(3000); // legítima + cuotas 10, 11, 12
  const r = await calcular(ent(id, { fecha_boleta: "2026-09-29", monto_boleta: monto.toFixed(2) }), dd);
  expect(r).toMatchObject({ aplica: true, montoCondonar: condonar.toFixed(2), moraACobrar: legit.toFixed(2), fechaVencimiento: "2026-09-29", diasRetraso: 4 });
  expect(r.porCuota.map((c) => [c.cuota_id, c.numero_cuota, c.fecha_vencimiento])).toEqual([
    [cuotaId(id, 11), 11, "2026-09-29"], [cuotaId(id, 12), 12, "2026-09-30"]]);
  const suma = r.porCuota.reduce((a, c) => a.plus(c.monto), new Big(0));
  expect(suma.minus(condonar).abs().lt("0.000001")).toBe(true); // el ledger (6 dec) suma lo condonado
  expect(r.porCuota.every((c) => /^\d+\.\d{6}$/.test(c.monto) && new Big(c.monto).gt(0))).toBe(true);
  expect(new Big(r.porCuota[0]!.monto).lte(v11.plus("0.000001"))).toBe(true);
  expect(new Big(r.porCuota[1]!.monto).lte(v12.plus("0.000001"))).toBe(true);
  // Con la boleta del 30-sep solo califica la 12; la 11 pasa a ser mora legítima.
  const monto30 = moraTotal.minus("11.20").plus(3000); // la legítima ahora incluye los 14.93 de la cuota 11
  const r30 = await calcular(ent(id, { fecha_boleta: "2026-09-30", monto_boleta: monto30.toFixed(2) }), dd);
  expect(r30.porCuota.map((c) => c.numero_cuota)).toEqual([12]);
  expect(r30.montoCondonar).toBe("11.20");
  // Pago que no llega a cubrir las 3 cuotas vencidas: no aplica, y el recuadro gris trae las fechas de las dos que calificaban.
  const corto = await calcular(ent(id, { fecha_boleta: "2026-09-29", monto_boleta: legit.round(2).plus(2999).toFixed(2) }), dd);
  expect(corto).toMatchObject({ aplica: false, razon: "no_queda_al_dia", fechaVencimiento: "2026-09-29", diasRetraso: 4, montoCondonar: "0.00", moraACobrar: "0.00", porCuota: [] });
});

integrationTest("mora ajustada a mano y mora ya cobrada (ledger): se condona lo que la cuota aún debe, nunca más", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const dd = await deps();
  // mora_activa MAYOR que lo devengado (+8.80 manual): solo se condona la mora de la ventana (11.20); el resto se cobra.
  const may = await sembrar(sql, { mora: "20.00", cuotas: tipicas });
  const rm = await calcular(ent(may, { monto_boleta: 1008.8 }), dd);
  expect(rm).toMatchObject({ aplica: true, montoCondonar: "11.20", moraACobrar: "8.80" });
  expect((await calcular(ent(may, { monto_boleta: 1008.79 }), dd)).aplica).toBe(true); // 0.01 corto: tolerancia
  expect((await calcular(ent(may, { monto_boleta: 1008.78 }), dd)).razon).toBe("no_queda_al_dia");
  // mora_activa MENOR (5.00 < 11.20): condona 5.00.
  const men = await sembrar(sql, { mora: "5.00", cuotas: tipicas });
  const rmen = await calcular(ent(men), dd);
  expect(rmen).toMatchObject({ aplica: true, montoCondonar: "5.00", moraACobrar: "0.00" });
  // Ledger: ya se cobraron 5.00 de la mora de la cuota 12 (PAGO) → pendiente 6.20; la mora activa quedó en 6.20.
  const led = await sembrar(sql, { mora: "6.20", cuotas: tipicas });
  const [pago] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado, "paymentFalse", pagado)
    VALUES (${led}, ${cuotaId(led, 12)}, 'validated', 5, false, false) RETURNING pago_id`;
  await sql`INSERT INTO cartera.mora_pagada_cuota (credito_id, cuota_id, pago_id, monto, tipo)
    VALUES (${led}, ${cuotaId(led, 12)}, ${pago!.pago_id}, 5.000000, 'PAGO')`;
  const rl = await calcular(ent(led), dd);
  expect(rl).toMatchObject({ aplica: true, montoCondonar: "6.20", moraACobrar: "0.00" });
  expect(rl.porCuota).toEqual([{ cuota_id: cuotaId(led, 12), numero_cuota: 12, fecha_vencimiento: "2026-09-30", monto: "6.200000" }]);
  // Ledger con una condonación previa que ya cubre toda la mora de la cuota (mora activa 0.00) → sin_mora, no se condona dos veces.
  const ya = await sembrar(sql, { mora: "0.00", cuotas: tipicas });
  await sql`INSERT INTO cartera.mora_pagada_cuota (credito_id, cuota_id, monto, tipo) VALUES (${ya}, ${cuotaId(ya, 12)}, 11.200000, 'CONDONACION')`;
  expect((await calcular(ent(ya), dd)).razon).toBe("sin_mora");
});

integrationTest("mora activa pero sin cuotas vencidas impagas (dato inconsistente) → no aplica, nunca condona", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: [
    { n: 11, venc: "2026-08-31", pagado: true }, { n: 12, venc: "2026-09-30", pagado: true }, { n: 13, venc: "2026-10-30" }] });
  const r = await calcular(ent(id, { monto_boleta: 5000 }), await deps());
  expect([r.aplica, r.montoCondonar, r.porCuota]).toEqual([false, "0.00", []]);
  const sinCuotas = await sembrar(sql, { mora: "11.20", cuotas: [] });
  expect((await calcular(ent(sinCuotas), await deps())).aplica).toBe(false);
});

integrationTest("cuota vencida sin mora pero con saldo (hoy vence) y un ajuste de fecha ideal pendiente consumen el disponible", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const dd = await deps();
  // Cuota 13 venció AYER (1 día de mora, no entra al tope? sí entra: boleta ≤ venc). Se necesita pagarla también.
  const id = await sembrar(sql, { mora: devengado(3).plus(devengado(1)).round(2).toFixed(2), cuotas: [
    { n: 11, venc: "2026-08-31", pagado: true }, { n: 12, venc: "2026-09-30" }, { n: 13, venc: "2026-10-02" }] });
  // Boleta del 30-sep: la 13 (vence 02-oct, boleta ≤ venc) también está en ventana; previa de la 12 = 31-ago.
  const r = await calcular(ent(id, { monto_boleta: 2000 }), dd);
  expect(r.aplica).toBe(true);
  expect(r.porCuota.map((c) => c.numero_cuota)).toEqual([12, 13]);
  expect((await calcular(ent(id, { monto_boleta: 1999.97 }), dd)).razon).toBe("no_queda_al_dia");
  // Ajuste de fecha ideal pendiente (solo se cobra con la cuota 1 abierta): con cuota 12/13 no debe restar.
  await sql`INSERT INTO cartera.ajuste_fecha_ideal_pago (credito_id, monto_total, fecha_cobro) VALUES (${id}, 500, NULL)`;
  expect((await calcular(ent(id, { monto_boleta: 2000 }), dd)).aplica).toBe(true);
  // Con cuota 1 abierta el ajuste se cobra del disponible.
  const uno = await sembrar(sql, { mora: "11.20", cuotas: [{ n: 0, venc: "2026-09-01", pagado: true }, { n: 1, venc: "2026-09-30" }] });
  await sql`INSERT INTO cartera.ajuste_fecha_ideal_pago (credito_id, monto_total, fecha_cobro) VALUES (${uno}, 300, NULL)`;
  const sinAjuste = await calcular(ent(uno, { monto_boleta: 1000 }), dd);
  expect(sinAjuste.razon).toBe("no_queda_al_dia"); // los 300 del ajuste se descuentan antes de la cuota
  expect((await calcular(ent(uno, { monto_boleta: 1300 }), dd)).aplica).toBe(true);
  // Ajuste ya cobrado (fecha_cobro no nula) no cuenta.
  const cobrado = await sembrar(sql, { mora: "11.20", cuotas: [{ n: 0, venc: "2026-09-01", pagado: true }, { n: 1, venc: "2026-09-30" }] });
  await sql`INSERT INTO cartera.ajuste_fecha_ideal_pago (credito_id, monto_total, fecha_cobro) VALUES (${cobrado}, 300, '2026-09-02')`;
  expect((await calcular(ent(cobrado, { monto_boleta: 1000 }), dd)).aplica).toBe(true);
});

integrationTest("el endpoint de lectura NO escribe nada: moras, condonaciones, ledger, historial ni pagos", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const a = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const b = await sembrar(sql, { status: "EN_CONVENIO", mora: "11.20", cuotas: tipicas });
  const c = await sembrar(sql, { mora: "20.00", cuotas: [...tipicas, { n: 12, venc: "2026-09-30", id: 99_999_010 }] });
  const antes = await huella(sql);
  const dd = await deps();
  const casos: EntradaBoletaTardia[] = [
    ent(a), ent(a, { monto_boleta: 5 }), ent(a, { fecha_boleta: "2026-10-04" }), ent(a, { fecha_boleta: "2026-10-01" }),
    ent(a, { fecha_boleta: "2026-08-01" }), ent(b), ent(c, { monto_boleta: 9000 }), ent(999_999), ent(a, { otros: 50, abono_directo_capital: 50 }),
  ];
  for (const e of casos) { await calcular(e, dd); await previa(e, dd); }
  expect(await huella(sql)).toEqual(antes);
});

integrationTest("vistaPrevia: intentoId UUID v4 distinto en CADA llamada (aplique o no) y sin moraActiva; calcular conserva moraActiva", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const si = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const no = await sembrar(sql, { status: "INCOBRABLE", mora: "11.20", cuotas: tipicas });
  const dd = await deps();
  const ids = new Set<string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (let i = 0; i < 25; i++) {
    for (const credito of [si, no, 999_999]) {
      const v = await previa(ent(credito), dd);
      expect(v.intentoId).toMatch(uuid);
      expect("moraActiva" in v).toBe(false);
      expect(JSON.stringify(v)).not.toContain("moraActiva");
      ids.add(v.intentoId);
    }
  }
  expect(ids.size).toBe(75);
  // El resto de la vista previa es idéntico entre llamadas (solo cambia el intentoId).
  const { intentoId: _a, ...v1 } = await previa(ent(si), dd);
  const { intentoId: _b, ...v2 } = await previa(ent(si), dd);
  expect(v1).toEqual(v2);
  expect((await calcular(ent(si), dd)).moraActiva).toBe("11.20");
  expect(v1.porCuota[0]!.cuota_id).toBe(cuotaId(si, 12));
});

integrationTest("fallas de lectura fallan cerradas: cuotasParaPendiente que lanza → la decisión lanza", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const id = await sembrar(sql, { mora: "11.20", cuotas: tipicas });
  const d0 = await deps();
  await expect(calcular(ent(id), { ...d0, cuotasParaPendiente: async () => { throw new Error("cuotas caído"); } })).rejects.toThrow("cuotas caído");
});
