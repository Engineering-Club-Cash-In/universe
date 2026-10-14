import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Big from "big.js";

/**
 * E2E de la vista previa de la boleta tardía (Tarea 5): `calcularDecisionBoletaTardia` con las dependencias REALES
 * (`cuotasParaPendienteDeCreditos`, `cobrarRubrosParaBoleta`, la base) sobre una COPIA de datos de producción.
 * Solo LEE. El monto condonado se compara contra un cálculo independiente en SQL (capital × 0.0112 × días/30 por
 * cuota, menos el ledger `mora_pagada_cuota`), no contra la implementación.
 *
 * Se salta si falta E2E_DB_URL. Preparación (copia descartable, nunca la base de PROD):
 *   docker exec cartera-local createdb -U postgres -T prod20261009 e2e_bt_t5
 *   (aplicar drizzle/0053, 0054 y 0055 con `docker exec -i cartera-local psql -U postgres -d e2e_bt_t5 -v ON_ERROR_STOP=1 -f - < archivo`)
 *   E2E_DB_URL=postgres://postgres:<pw>@localhost:5433/e2e_bt_t5 bun test src/controllers/boletaTardiaDecision.e2e.test.ts
 *   docker exec cartera-local dropdb -U postgres e2e_bt_t5
 *
 * `hoy` SE CONTROLA: la copia es del 09-oct (la mora de sus 680 créditos activos coincide al centavo con las fechas de
 * ese día), así que la decisión se evalúa con hoy = 09-oct-2026 vía `deps.hoy`. (La ventana de 7 días de los pagos
 * pendientes dentro de `cuotasParaPendienteDeCreditos` usa `now()` real; los créditos elegidos no tienen pendientes.)
 */
const E2E_DB_URL = process.env.E2E_DB_URL;
const PROD_SYSTEM_IDENTIFIER = "7473814220388481052";
const DB_ESPERADA = "e2e_bt_t5";
const HOY_YMD = "2026-10-09";
const HOY = new Date(2026, 9, 9); // campos LOCALES = hora de pared de Guatemala (como hoyGuatemala())

// Antes de CUALQUIER import de la app: `database/index.ts` lee SUPABASE_DB_URL al cargarse.
if (E2E_DB_URL) process.env.SUPABASE_DB_URL = E2E_DB_URL;
process.env.RESEND_API_KEY ??= "e2e-inerte";
process.env.EMAIL_DOMAIN ??= "e2e.invalid";

const suite = E2E_DB_URL ? describe : describe.skip;

let pool: any; // `pg` sin tipos en este paquete (igual que database/index.ts)
let calcular: typeof import("./boletaTardiaDecision").calcularDecisionBoletaTardia;
let depsReales: typeof import("./boletaTardiaDecision").depsDecisionReales;

type FilaCuota = {
  cuota_id: number; numero_cuota: number; venc: string; dias: number; cubierta: boolean; ledger: string; saldo: string;
  prev_venc: string | null;
};
type Datos = { capital: string; monto_mora: string; status: string; filas: FilaCuota[] };

/** Todo en SQL puro con `hoy` fijo: cuotas vencidas impagas, si el cron las cubre, ledger, saldo y vencimiento previo. */
async function datosDe(id: number): Promise<Datos> {
  const c = (await pool.query(
    `SELECT c.capital::text AS capital, c."statusCredit" AS status, m.monto_mora::text AS monto_mora
     FROM cartera.creditos c JOIN cartera.moras_credito m ON m.credito_id=c.credito_id AND m.activa WHERE c.credito_id=$1`, [id])).rows[0];
  const filas = (await pool.query(
    `SELECT q.cuota_id, q.numero_cuota, to_char(q.fecha_vencimiento,'YYYY-MM-DD') AS venc, ($2::date - q.fecha_vencimiento) AS dias,
       EXISTS (SELECT 1 FROM cartera.pagos_credito pc WHERE pc.cuota_id=q.cuota_id AND NOT pc."paymentFalse" AND pc.pagado
         AND COALESCE(pc.monto_aplicado,0)>0 AND pc.validation_status IN ('validated','no_required')) AS cubierta,
       COALESCE((SELECT sum(l.monto) FROM cartera.mora_pagada_cuota l WHERE l.cuota_id=q.cuota_id),0)::text AS ledger,
       GREATEST(0, cr.cuota - COALESCE((SELECT sum(COALESCE(p.abono_capital,0)+COALESCE(p.abono_interes,0)+COALESCE(p.abono_iva_12,0)
         +COALESCE(p.abono_seguro,0)+COALESCE(p.abono_gps,0)+COALESCE(p.membresias_pago,0))
         FROM cartera.pagos_credito p WHERE p.cuota_id=q.cuota_id AND NOT p."paymentFalse" AND p.validation_status='validated'),0))::text AS saldo,
       (SELECT to_char(p2.fecha_vencimiento,'YYYY-MM-DD') FROM cartera.cuotas_credito p2
         WHERE p2.credito_id=q.credito_id AND p2.numero_cuota=q.numero_cuota-1 ORDER BY p2.cuota_id DESC LIMIT 1) AS prev_venc
     FROM cartera.cuotas_credito q JOIN cartera.creditos cr ON cr.credito_id=q.credito_id
     WHERE q.credito_id=$1 AND NOT q.pagado AND q.fecha_vencimiento < $2::date ORDER BY q.numero_cuota`, [id, HOY_YMD])).rows;
  return { ...c, filas: filas.map((f: any) => ({ ...f, dias: Number(f.dias) })) };
}

const ceil2 = (x: Big) => x.times(100).round(0, Big.roundUp).div(100);
const floor2 = (x: Big) => x.times(100).round(0, Big.roundDown).div(100);
const dev = (capital: string, f: FilaCuota) =>
  Big(capital).times("0.0112").times(Math.min(1, f.dias / 30)).minus(f.ledger);
const pos = (x: Big) => (x.lt(0) ? Big(0) : x);

/** Expectativa independiente (spec §2): boleta = vencimiento de la cuota en ventana más vieja; mora de la ventana vs legítima. */
function esperado(d: Datos) {
  const conMora = d.filas.filter((f) => !f.cubierta);
  const candidatas = conMora.filter((f) => f.dias <= 5);
  const boleta = candidatas.map((f) => f.venc).sort()[0]!;
  const masVieja = candidatas.find((f) => f.venc === boleta)!;
  const periodoOk = masVieja.numero_cuota === 1 || (masVieja.prev_venc !== null && masVieja.prev_venc < boleta);
  const ventana = conMora.filter((f) => f.dias <= 5 && f.venc >= boleta);
  const moraVentana = ventana.reduce((a, f) => a.plus(pos(dev(d.capital, f))), Big(0));
  const moraLegit = conMora.filter((f) => !ventana.includes(f)).reduce((a, f) => a.plus(pos(dev(d.capital, f))), Big(0));
  const resto = Big(d.monto_mora).minus(moraLegit.round(2));
  const tope = ceil2(moraVentana);
  const condonar = floor2(resto.lt(tope) ? resto : tope);
  const cobrar = Big(d.monto_mora).minus(condonar);
  const saldoVencidas = d.filas.reduce((a, f) => a.plus(f.saldo), Big(0));
  const ultima = d.filas[d.filas.length - 1]!; // la de mayor numero_cuota recibe el faltante
  return { boleta, periodoOk, ventana, condonar, cobrar, need: cobrar.plus(saldoVencidas), saldoUltima: Big(ultima.saldo) };
}

/** 10 créditos reales (ACTIVO/MOROSO, mora activa, cuota vencida hace 1–5 días a `hoy`), sin pendientes/duplicadas/rubros/ajuste. */
async function elegirCreditos(): Promise<{ id: number; dias: number; n: number }[]> {
  const r = await pool.query(
    `WITH uc AS (
       SELECT c.credito_id, q.cuota_id, ($1::date - q.fecha_vencimiento) AS dias
       FROM cartera.creditos c JOIN cartera.moras_credito m ON m.credito_id=c.credito_id AND m.activa AND m.monto_mora>0
       JOIN cartera.cuotas_credito q ON q.credito_id=c.credito_id AND NOT q.pagado AND q.fecha_vencimiento < $1::date
       WHERE c."statusCredit" IN ('ACTIVO','MOROSO')
         AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito pc WHERE pc.cuota_id=q.cuota_id AND NOT pc."paymentFalse" AND pc.pagado
             AND COALESCE(pc.monto_aplicado,0)>0 AND pc.validation_status IN ('validated','no_required'))
     )
     SELECT credito_id, count(*)::int AS n, min(dias)::int AS dias FROM uc
     WHERE credito_id NOT IN (SELECT credito_id FROM cartera.cuotas_credito GROUP BY credito_id, numero_cuota HAVING count(*)>1)
       AND credito_id NOT IN (SELECT credito_id FROM cartera.pagos_credito WHERE validation_status='pending' AND NOT "paymentFalse" AND cuota_id IN
             (SELECT cuota_id FROM cartera.cuotas_credito WHERE NOT pagado))
       AND credito_id NOT IN (SELECT credito_id FROM cartera.ajuste_fecha_ideal_pago WHERE fecha_cobro IS NULL)
       AND credito_id NOT IN (SELECT credito_id FROM cartera.rubros WHERE activo AND NOT completado AND NOT anulado)
       AND credito_id IN (SELECT credito_id FROM cartera.cuotas_credito q WHERE q.numero_cuota > 1 GROUP BY credito_id)
     GROUP BY credito_id HAVING min(dias) BETWEEN 1 AND 5 ORDER BY credito_id`, [HOY_YMD]);
  const todos = r.rows as { credito_id: number; n: number; dias: number }[];
  const unicas = todos.filter((x) => x.n === 1);
  const multi = todos.filter((x) => x.n > 1);
  const elegidos: { id: number; dias: number; n: number }[] = [];
  // 6 de una sola cuota repartidas por días de atraso (round-robin 1..5) y 4 con mora legítima de cuotas viejas.
  for (let ronda = 0; elegidos.length < 6 && ronda < 3; ronda++) {
    for (let d = 1; d <= 5 && elegidos.length < 6; d++) {
      const x = unicas.filter((u) => u.dias === d)[ronda];
      if (x) elegidos.push({ id: x.credito_id, dias: x.dias, n: x.n });
    }
  }
  for (const x of multi) { if (elegidos.length >= 10) break; elegidos.push({ id: x.credito_id, dias: x.dias, n: x.n }); }
  for (const x of unicas) { if (elegidos.length >= 10) break; if (!elegidos.some((e) => e.id === x.credito_id)) elegidos.push({ id: x.credito_id, dias: x.dias, n: x.n }); }
  return elegidos;
}

suite("vista previa de boleta tardía sobre la copia de PROD (hoy fijo 09-oct)", () => {
  let creditos: { id: number; dias: number; n: number }[] = [];

  beforeAll(async () => {
    // --- Guardas de seguridad: ABORTAN antes de leer nada ---
    const u = new URL(E2E_DB_URL!);
    if (!(u.hostname === "localhost" && u.port === "5433")) throw new Error(`E2E_DB_URL no es localhost:5433 (${u.host})`);
    if (u.pathname !== `/${DB_ESPERADA}`) throw new Error(`La base no es ${DB_ESPERADA}: ${u.pathname}`);
    const database = await import("../database");
    const efectiva = (database.client as any).options?.connectionString as string;
    if (efectiva !== E2E_DB_URL) throw new Error("La app NO apunta a E2E_DB_URL; aborto");
    pool = database.client;
    const ident = (await pool.query(`SELECT system_identifier::text AS s FROM pg_control_system()`)).rows[0].s;
    if (ident === PROD_SYSTEM_IDENTIFIER) throw new Error("system_identifier de PROD; aborto");
    const cur = (await pool.query(`SELECT current_database() AS d`)).rows[0].d;
    if (cur !== DB_ESPERADA) throw new Error(`current_database=${cur}; aborto`);
    ({ calcularDecisionBoletaTardia: calcular, depsDecisionReales: depsReales } = await import("./boletaTardiaDecision"));
    creditos = await elegirCreditos();
    // eslint-disable-next-line no-console
    console.log("Créditos usados:", creditos.map((c) => `${c.id} (${c.dias}d, ${c.n} cuota(s) con mora)`).join("; "));
  });

  afterAll(async () => {
    const database = await import("../database");
    await pool?.end().catch(() => {});
    await database.lockPool.end().catch(() => {});
  });

  const entrada = (id: number, fecha: string, monto: number | string) => ({ credito_id: id, monto_boleta: monto, fecha_boleta: fecha });
  const deps = () => ({ ...depsReales(), hoy: () => HOY });

  test("hay 10 créditos reales con cuota vencida hace ≤5 días", () => {
    expect(creditos.length).toBe(10);
    expect(new Set(creditos.map((c) => c.dias)).size).toBeGreaterThanOrEqual(3);
    expect(creditos.some((c) => c.n > 1)).toBe(true);
  });

  test("cada crédito: boleta = vencimiento y monto justo → aplica y montoCondonar = cálculo SQL independiente", async () => {
    for (const { id } of creditos) {
      const d = await datosDe(id);
      const e = esperado(d);
      expect(e.periodoOk).toBe(true);
      const r = await calcular(entrada(id, e.boleta, e.need.toFixed(2)), deps());
      const ctx = `crédito ${id}`;
      expect([ctx, r.aplica, r.razon]).toEqual([ctx, true, null]);
      expect([ctx, r.montoCondonar]).toEqual([ctx, e.condonar.toFixed(2)]);
      expect([ctx, r.moraACobrar]).toEqual([ctx, e.cobrar.toFixed(2)]);
      expect([ctx, r.moraActiva]).toEqual([ctx, Big(d.monto_mora).toFixed(2)]);
      expect([ctx, r.fechaRegistro, r.fechaBoleta, r.fechaVencimiento]).toEqual([ctx, HOY_YMD, e.boleta, e.boleta]);
      expect([ctx, r.diasRetraso]).toEqual([ctx, Math.round((Date.UTC(2026, 9, 9) - Date.parse(`${e.boleta}T00:00:00Z`)) / 86_400_000)]);
      // El reparto va a las cuotas de la ventana y suma lo condonado (ledger de 6 decimales).
      expect([ctx, r.porCuota.map((c) => c.cuota_id).sort()]).toEqual([ctx, e.ventana.map((f) => f.cuota_id).sort()]);
      const suma = r.porCuota.reduce((a, c) => a.plus(c.monto), Big(0));
      // El ledger reparte min(condonado, devengado de la ventana): difiere del monto de moras_credito en < Q0.01 (E-13 revocada).
      const moraVentana = e.ventana.reduce((a, f) => a.plus(pos(dev(d.capital, f))), Big(0));
      const esperadoLedger = e.condonar.lt(moraVentana) ? e.condonar : moraVentana;
      expect([ctx, suma.minus(esperadoLedger).abs().lt("0.000001"), e.condonar.minus(suma).lt("0.01"), suma.lte(e.condonar)]).toEqual([ctx, true, true, true]);
      for (const c of r.porCuota) {
        const f = e.ventana.find((v) => v.cuota_id === c.cuota_id)!;
        expect([ctx, c.numero_cuota, c.fecha_vencimiento]).toEqual([ctx, f.numero_cuota, f.venc]);
        expect([ctx, Big(c.monto).lte(pos(dev(d.capital, f)).plus("0.000001"))]).toEqual([ctx, true]);
      }
    }
  });

  test("cada crédito: monto corto no aplica (0.02 corto → no_queda_al_dia; < mora a cobrar → no_alcanza_mora); 0.01 corto pasa por la tolerancia de Q0.01", async () => {
    for (const { id } of creditos) {
      const d = await datosDe(id);
      const e = esperado(d);
      const ctx = `crédito ${id}`;
      // La tolerancia del "queda al día" es saldo > Q0.01: un centavo de faltante en la última cuota todavía queda al día.
      const unCentavo = await calcular(entrada(id, e.boleta, e.need.minus("0.01").toFixed(2)), deps());
      expect([ctx, unCentavo.aplica, unCentavo.montoCondonar]).toEqual([ctx, true, e.condonar.toFixed(2)]);
      const dosCentavos = await calcular(entrada(id, e.boleta, e.need.minus("0.02").toFixed(2)), deps());
      expect([ctx, dosCentavos.aplica, dosCentavos.razon, dosCentavos.montoCondonar, dosCentavos.porCuota]).toEqual([ctx, false, "no_queda_al_dia", "0.00", []]);
      expect([ctx, dosCentavos.fechaVencimiento]).toEqual([ctx, e.boleta]); // el recuadro gris trae las fechas de lo que calificaba
      // Un faltante grande (una cuota entera menos) tampoco.
      const corto = await calcular(entrada(id, e.boleta, pos(e.need.minus(e.saldoUltima).minus("0.02")).toFixed(2)), deps());
      expect([ctx, corto.aplica]).toEqual([ctx, false]);
      // No alcanza ni la mora que se cobra primero.
      if (e.cobrar.gt("0.01")) {
        const sinMora = await calcular(entrada(id, e.boleta, e.cobrar.minus("0.01").toFixed(2)), deps());
        expect([ctx, sinMora.aplica, sinMora.razon]).toEqual([ctx, false, "no_alcanza_mora"]);
      }
    }
  });

  test("cada crédito: boleta un día DESPUÉS del vencimiento (o hoy) no es a tiempo → fuera_de_ventana; boleta futura → boleta_invalida", async () => {
    for (const { id } of creditos) {
      const e = esperado(await datosDe(id));
      const ctx = `crédito ${id}`;
      const despues = new Date(Date.parse(`${e.boleta}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      if (despues <= HOY_YMD) {
        const r = await calcular(entrada(id, despues, e.need.plus(5000).toFixed(2)), deps());
        expect([ctx, r.aplica, r.razon]).toEqual([ctx, false, "fuera_de_ventana"]);
      }
      const futura = await calcular(entrada(id, "2026-10-10", e.need.plus(5000).toFixed(2)), deps());
      expect([ctx, futura.aplica, futura.razon]).toEqual([ctx, false, "boleta_invalida"]);
    }
  });

  test("tope: avanzando `hoy` hasta que la cuota MÁS NUEVA de la ventana lleve 6 días, la misma boleta ya no condona (fuera_de_tope)", async () => {
    for (const { id } of creditos) {
      const e = esperado(await datosDe(id));
      const ctx = `crédito ${id}`;
      const masNueva = Math.min(...e.ventana.map((f) => f.dias));
      const hoy6 = new Date(2026, 9, 9 + (6 - masNueva));
      const r = await calcular(entrada(id, e.boleta, "100000.00"), { ...depsReales(), hoy: () => hoy6 });
      expect([ctx, r.aplica, r.razon, r.montoCondonar]).toEqual([ctx, false, "fuera_de_tope", "0.00"]);
      // Un día antes (la cuota más nueva con 5 días) sigue dentro del tope: el borde es 5 entra / 6 no.
      const hoy5 = new Date(2026, 9, 9 + (5 - masNueva));
      const r5 = await calcular(entrada(id, e.boleta, "100000.00"), { ...depsReales(), hoy: () => hoy5 });
      expect([ctx, r5.aplica]).toEqual([ctx, true]);
    }
  });

  test("solo lee: antes y después de las 10 decisiones las tablas de mora/pagos quedan idénticas", async () => {
    const huella = async () => {
      const out: string[] = [];
      for (const t of ["moras_credito", "moras_condonaciones", "mora_pagada_cuota", "moras_historial", "pagos_credito"]) {
        const r = await pool.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM cartera.${t} x`);
        out.push(`${t}:${r.rows[0].n}:${r.rows[0].h}`);
      }
      return out;
    };
    const antes = await huella();
    for (const { id } of creditos) {
      const e = esperado(await datosDe(id));
      await calcular(entrada(id, e.boleta, e.need.toFixed(2)), deps());
      await calcular(entrada(id, e.boleta, "1.00"), deps());
    }
    expect(await huella()).toEqual(antes);
  });
});
