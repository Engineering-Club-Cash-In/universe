import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Big from "big.js";
import { randomUUID } from "node:crypto";

/**
 * E2E de la Tarea 6.c: el flujo COMPLETO de boleta tardía (`registrarPagoConBoletaTardia`) con `insertPayment`,
 * `calcularDecisionBoletaTardia`, `condonarMoraDeCuotas`, `anularCondonacionBoletaTardia` y `evaluarCreditoAlDia`
 * REALES (sin fakes) sobre una COPIA de datos de producción. Las pruebas ESCRIBEN en la copia.
 *
 * Se salta si falta E2E_DB_URL. Preparación (copia descartable, nunca la base de PROD):
 *   docker exec cartera-local createdb -U postgres -T prod20261009 e2e_bt_6c
 *   (aplicar drizzle/0053, 0054 y 0055 con `docker exec -i cartera-local psql -U postgres -d e2e_bt_6c -v ON_ERROR_STOP=1 -f - < archivo`)
 *   E2E_DB_URL=postgres://postgres:<pw>@localhost:5433/e2e_bt_6c bun test src/controllers/boletaTardia.e2e.test.ts
 *   docker exec cartera-local dropdb -U postgres e2e_bt_6c
 *
 * CONTROL DE `hoy`: la copia es del 09-oct-2026 (la mora de sus créditos coincide con las fechas de ese día), así que
 * la DECISIÓN se evalúa con hoy = 09-oct (se inyecta `deps.hoy`). El resto (`insertPayment`, `evaluarCreditoAlDia`,
 * `validarFechaBoleta`) usa la fecha REAL; por eso solo se eligen créditos sin ninguna cuota impaga que venza entre el
 * 09-oct y hoy (si no, "no quedó al día" sería un artefacto del reloj, no un hallazgo).
 */
const E2E_DB_URL = process.env.E2E_DB_URL;
const PROD_SYSTEM_IDENTIFIER = "7473814220388481052";
const DB_ESPERADA = "e2e_bt_6c";
const HOY_YMD = "2026-10-09";
const HOY = new Date(2026, 9, 9);
const EMAIL = "jalvarado@clubcashin.com";

// Antes de CUALQUIER import de la app: `database/index.ts` lee SUPABASE_DB_URL al cargarse.
if (E2E_DB_URL) process.env.SUPABASE_DB_URL = E2E_DB_URL;
process.env.RESEND_API_KEY ??= "e2e-inerte";
process.env.EMAIL_DOMAIN ??= "e2e.invalid";

const suite = E2E_DB_URL ? describe : describe.skip;
const hoyReal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());

let pool: any;
let registrar: typeof import("./boletaTardia").registrarPagoConBoletaTardia;
let depsBT: typeof import("./boletaTardia").depsReales;
let calcular: typeof import("./boletaTardiaDecision").calcularDecisionBoletaTardia;
let depsDecision: typeof import("./boletaTardiaDecision").depsDecisionReales;
let condonar: typeof import("./latefee").condonarMoraDeCuotas;
let insertPayment: typeof import("./registerPayment").insertPayment;
let BANCO_ID = 0;

type FilaCuota = { cuota_id: number; numero_cuota: number; venc: string; dias: number; cubierta: boolean; ledger: string; saldo: string };
type Datos = { capital: string; monto_mora: string; filas: FilaCuota[] };

async function datosDe(id: number): Promise<Datos> {
  const c = (await pool.query(
    `SELECT c.capital::text AS capital, m.monto_mora::text AS monto_mora
     FROM cartera.creditos c JOIN cartera.moras_credito m ON m.credito_id=c.credito_id AND m.activa WHERE c.credito_id=$1`, [id])).rows[0];
  const filas = (await pool.query(
    `SELECT q.cuota_id, q.numero_cuota, to_char(q.fecha_vencimiento,'YYYY-MM-DD') AS venc, ($2::date - q.fecha_vencimiento) AS dias,
       EXISTS (SELECT 1 FROM cartera.pagos_credito pc WHERE pc.cuota_id=q.cuota_id AND NOT pc."paymentFalse" AND pc.pagado
         AND COALESCE(pc.monto_aplicado,0)>0 AND pc.validation_status IN ('validated','no_required')) AS cubierta,
       COALESCE((SELECT sum(l.monto) FROM cartera.mora_pagada_cuota l WHERE l.cuota_id=q.cuota_id),0)::text AS ledger,
       GREATEST(0, cr.cuota - COALESCE((SELECT sum(COALESCE(p.abono_capital,0)+COALESCE(p.abono_interes,0)+COALESCE(p.abono_iva_12,0)
         +COALESCE(p.abono_seguro,0)+COALESCE(p.abono_gps,0)+COALESCE(p.membresias_pago,0))
         FROM cartera.pagos_credito p WHERE p.cuota_id=q.cuota_id AND NOT p."paymentFalse" AND p.validation_status='validated'),0))::text AS saldo
     FROM cartera.cuotas_credito q JOIN cartera.creditos cr ON cr.credito_id=q.credito_id
     WHERE q.credito_id=$1 AND NOT q.pagado AND q.fecha_vencimiento < $2::date ORDER BY q.numero_cuota`, [id, HOY_YMD])).rows;
  return { ...c, filas: filas.map((f: any) => ({ ...f, dias: Number(f.dias) })) };
}
const ceil2 = (x: Big) => x.times(100).round(0, Big.roundUp).div(100);
const floor2 = (x: Big) => x.times(100).round(0, Big.roundDown).div(100);
const dev = (capital: string, f: FilaCuota) => Big(capital).times("0.0112").times(Math.min(1, f.dias / 30)).minus(f.ledger);
const pos = (x: Big) => (x.lt(0) ? Big(0) : x);

/** Expectativa independiente en SQL/aritmética (spec §2): qué condonar, qué mora se cobra y cuánto hay que pagar para quedar al día. */
function esperado(d: Datos) {
  const conMora = d.filas.filter((f) => !f.cubierta);
  const candidatas = conMora.filter((f) => f.dias <= 5);
  const boleta = candidatas.map((f) => f.venc).sort()[0]!;
  const ventana = conMora.filter((f) => f.dias <= 5 && f.venc >= boleta);
  const moraVentana = ventana.reduce((a, f) => a.plus(pos(dev(d.capital, f))), Big(0));
  const moraLegit = conMora.filter((f) => !ventana.includes(f)).reduce((a, f) => a.plus(pos(dev(d.capital, f))), Big(0));
  const resto = Big(d.monto_mora).minus(moraLegit.round(2));
  const tope = ceil2(moraVentana);
  const condonarMonto = floor2(resto.lt(tope) ? resto : tope);
  const cobrar = Big(d.monto_mora).minus(condonarMonto);
  const saldoVencidas = d.filas.reduce((a, f) => a.plus(f.saldo), Big(0));
  return { boleta, condonar: condonarMonto, cobrar, need: cobrar.plus(saldoVencidas) };
}

async function elegirCreditos(n: number): Promise<number[]> {
  const r = await pool.query(
    `WITH uc AS (
       SELECT c.credito_id, q.cuota_id, ($1::date - q.fecha_vencimiento) AS dias
       FROM cartera.creditos c JOIN cartera.moras_credito m ON m.credito_id=c.credito_id AND m.activa AND m.monto_mora>0
       JOIN cartera.cuotas_credito q ON q.credito_id=c.credito_id AND NOT q.pagado AND q.fecha_vencimiento < $1::date
       WHERE c."statusCredit" IN ('ACTIVO','MOROSO')
         AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito pc WHERE pc.cuota_id=q.cuota_id AND NOT pc."paymentFalse" AND pc.pagado
             AND COALESCE(pc.monto_aplicado,0)>0 AND pc.validation_status IN ('validated','no_required'))
     )
     SELECT credito_id FROM uc
     WHERE credito_id NOT IN (SELECT credito_id FROM cartera.cuotas_credito GROUP BY credito_id, numero_cuota HAVING count(*)>1)
       AND credito_id NOT IN (SELECT credito_id FROM cartera.pagos_credito WHERE validation_status='pending' AND NOT "paymentFalse" AND cuota_id IN
             (SELECT cuota_id FROM cartera.cuotas_credito WHERE NOT pagado))
       AND credito_id NOT IN (SELECT credito_id FROM cartera.ajuste_fecha_ideal_pago WHERE fecha_cobro IS NULL)
       AND credito_id NOT IN (SELECT credito_id FROM cartera.rubros WHERE activo AND NOT completado AND NOT anulado)
       AND credito_id NOT IN (SELECT credito_id FROM cartera.cuotas_credito WHERE NOT pagado AND fecha_vencimiento >= $1::date AND fecha_vencimiento <= $2::date)
       AND credito_id IN (SELECT credito_id FROM cartera.cuotas_credito q WHERE q.numero_cuota > 1 GROUP BY credito_id)
     GROUP BY credito_id HAVING min(dias) BETWEEN 1 AND 5 AND count(*) = 1 ORDER BY credito_id`, [HOY_YMD, hoyReal]);
  // Se reparten a lo largo de la lista para variar días de atraso.
  const todos: number[] = r.rows.map((x: any) => x.credito_id);
  const paso = Math.max(1, Math.floor(todos.length / n));
  return Array.from({ length: n }, (_, i) => todos[i * paso]!).filter((x) => x !== undefined);
}

const decidirHoy9 = (): any => (entrada: any) => calcular(entrada, { ...depsDecision(), hoy: () => HOY });
const deps = (o: Record<string, unknown> = {}) => ({ ...depsBT(), decidir: decidirHoy9(), ...o }) as ReturnType<typeof depsBT>;

type Prep = { ledger0: { CONDONACION: Big; ANULACION: Big }; credito: number; usuario_id: number; e: ReturnType<typeof esperado>; moraAntes: string; body: any; intento: string };
async function preparar(credito: number, extra: { sumarMonto?: number } = {}): Promise<Prep> {
  const d = await datosDe(credito);
  const e = esperado(d);
  const u = (await pool.query(`SELECT usuario_id FROM cartera.creditos WHERE credito_id=$1`, [credito])).rows[0].usuario_id;
  const intento = randomUUID();
  const body = {
    credito_id: credito, usuario_id: u, monto_boleta: Number(e.need.plus(extra.sumarMonto ?? 0).toFixed(2)), fecha_pago: hoyReal,
    fecha_boleta: e.boleta, cuotaApagar: 1, url_boletas: ["e2e-boleta.jpg"], banco_id: BANCO_ID, numeroAutorizacion: `E2E6C-${randomUUID()}`,
    registerBy: EMAIL, origen_pago: "boleta", condonacionBoletaTardia: { intentoId: intento, montoAceptado: e.condonar.toFixed(2) },
  };
  const l = await sql(`SELECT tipo, sum(monto)::text AS m FROM cartera.mora_pagada_cuota WHERE credito_id=$1 GROUP BY tipo`, [credito]);
  const g = (t: string) => Big(l.find((x: any) => x.tipo === t)?.m ?? 0);
  return { ledger0: { CONDONACION: g("CONDONACION"), ANULACION: g("ANULACION") }, credito, usuario_id: u, e, moraAntes: d.monto_mora, body, intento };
}
const correr = async (p: Prep, d = deps(), body = p.body) => {
  const set: { status?: number } = {};
  let r: any, error: any;
  try { r = await registrar({ body, set }, { usuarioEmail: EMAIL }, d); } catch (e) { error = e; }
  return { r, error, status: set.status };
};

async function sql(q: string, params: unknown[] = []) { return (await pool.query(q, params)).rows as any[]; }
async function foto(credito: number, intento: string) {
  const [mora] = await sql(`SELECT mora_id, monto_mora::text AS monto, activa FROM cartera.moras_credito WHERE credito_id=$1 ORDER BY mora_id DESC LIMIT 1`, [credito]);
  const conds = await sql(
    `SELECT c.condonacion_id, c.monto_condonacion::text AS monto, c.anulada_at IS NOT NULL AS anulada, c.intento_id::text AS intento, u.email
     FROM cartera.moras_condonaciones c LEFT JOIN cartera.platform_users u ON u.id=c.usuario_id WHERE c.credito_id=$1 AND c.intento_id IS NOT NULL ORDER BY c.condonacion_id`, [credito]);
  const filas = await sql(`SELECT pago_id, mora::text AS mora, "paymentFalse" AS falso, validation_status AS st FROM cartera.pagos_credito WHERE credito_id=$1 AND boleta_tardia_intento_id=$2 ORDER BY pago_id`, [credito, intento]);
  const sinMarca = await sql(`SELECT pago_id FROM cartera.pagos_credito WHERE credito_id=$1 AND numeroautorizacion LIKE 'E2E6C-%' AND boleta_tardia_intento_id IS NULL`, [credito]);
  const ledger = await sql(`SELECT tipo, sum(monto)::text AS monto FROM cartera.mora_pagada_cuota WHERE credito_id=$1 GROUP BY tipo ORDER BY tipo`, [credito]);
  const hist = await sql(`SELECT tipo_evento, origen, monto_anterior::text AS ant, monto_nuevo::text AS nue FROM cartera.moras_historial WHERE credito_id=$1 ORDER BY historial_id`, [credito]);
  return { mora, conds, filas, sinMarca, ledger, hist };
}
const ledgerDe = (f: Awaited<ReturnType<typeof foto>>, tipo: string) => Big(f.ledger.find((l: any) => l.tipo === tipo)?.monto ?? 0);
const condonadoEnHistorial = (f: Awaited<ReturnType<typeof foto>>) =>
  f.hist.filter((h: any) => h.tipo_evento === "CONDONACION" && h.origen === "CONDONACION_BOLETA_TARDIA");

let pool_creditos: number[] = [];
const tomar = () => { const c = pool_creditos.shift(); if (c === undefined) throw new Error("se acabaron los créditos del E2E"); return c; };
const usados: string[] = [];
const T = 90_000;

suite("boleta tardía E2E: registrarPagoConBoletaTardia + insertPayment REAL sobre la copia de PROD (decisión con hoy=09-oct)", () => {
  beforeAll(async () => {
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
    const col = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='cartera' AND table_name='moras_condonaciones' AND column_name='intento_id'`);
    if (col.rowCount !== 1) throw new Error("Faltan las migraciones 0053-0055 en la copia");
    ({ registrarPagoConBoletaTardia: registrar, depsReales: depsBT } = await import("./boletaTardia"));
    ({ calcularDecisionBoletaTardia: calcular, depsDecisionReales: depsDecision } = await import("./boletaTardiaDecision"));
    ({ condonarMoraDeCuotas: condonar } = await import("./latefee"));
    ({ insertPayment } = await import("./registerPayment"));
    BANCO_ID = (await pool.query(`SELECT banco_id FROM cartera.bancos ORDER BY banco_id LIMIT 1`)).rows[0].banco_id;
    pool_creditos = await elegirCreditos(16);
    console.log("Créditos candidatos:", pool_creditos.join(","));
  }, T);

  afterAll(async () => {
    console.log("Créditos usados:", usados.join("; "));
    await pool?.query(`DROP TRIGGER IF EXISTS e2e6c_anula_rubro ON cartera.pagos_credito`).catch(() => {});
    await pool?.query(`DROP FUNCTION IF EXISTS cartera.e2e6c_anula_rubro()`).catch(() => {});
    const database = await import("../database");
    await pool?.end().catch(() => {});
    await database.lockPool.end().catch(() => {});
  });

  /** Verificación común de un registro exitoso con condonación vigente. */
  const afirmarExito = (p: Prep, f: Awaited<ReturnType<typeof foto>>, res: Awaited<ReturnType<typeof correr>>) => {
    if (res.error || res.r?.success !== true) console.log(`[DEBUG c${p.credito}] status=${res.status} error=${res.error} r=${JSON.stringify(res.r)}`);
    expect(res.error).toBeUndefined();
    expect(res.status ?? 200).toBeLessThan(400);
    expect(res.r.success).toBe(true);
    expect(res.r.condonacionBoletaTardia.estado).toBe("vigente");
    expect(res.r.condonacionBoletaTardia.monto).toBe(p.e.condonar.toFixed(2));
    // Una sola condonación, viva, firmada por el usuario verificado y con el intento.
    expect(f.conds).toHaveLength(1);
    expect(f.conds[0]).toMatchObject({ anulada: false, intento: p.intento, email: EMAIL, monto: p.e.condonar.toFixed(2) });
    // Mora rebajada = lo condonado (historial) y ledger CONDONACION ≈ lo condonado (< Q0.01, E-13 revocada).
    const h = condonadoEnHistorial(f);
    expect(h).toHaveLength(1);
    expect(Big(h[0].ant).minus(h[0].nue).toFixed(2)).toBe(p.e.condonar.toFixed(2));
    expect(h[0].ant).toBe(Big(p.moraAntes).toFixed(2));
    expect(ledgerDe(f, "CONDONACION").minus(p.ledger0.CONDONACION).minus(p.e.condonar).abs().lt("0.01")).toBe(true);
    // El pago cobró solo la mora legítima, y TODAS las filas de la boleta están marcadas.
    expect(f.filas.length).toBeGreaterThan(0);
    expect(f.filas.every((x: any) => x.falso === false)).toBe(true);
    expect(f.filas.reduce((a: Big, x: any) => a.plus(x.mora ?? 0), Big(0)).toFixed(2)).toBe(p.e.cobrar.toFixed(2));
    expect(f.sinMarca).toEqual([]);
  };

  test("1. registro normal con condonación: mora rebajada = condonado, el pago cobra solo la legítima, filas marcadas, vigente", async () => {
    const p = await preparar(tomar()); usados.push(`1:${p.credito}`);
    const res = await correr(p);
    afirmarExito(p, await foto(p.credito, p.intento), res);
    expect(Number(p.e.condonar)).toBeGreaterThan(0);
  }, T);

  test("2a. doble llamada SECUENCIAL con el mismo intento: un solo pago, una sola condonación", async () => {
    const p = await preparar(tomar()); usados.push(`2a:${p.credito}`);
    const r1 = await correr(p);
    const antes = await foto(p.credito, p.intento);
    const r2 = await correr(p);
    const f = await foto(p.credito, p.intento);
    afirmarExito(p, antes, r1);
    expect(r2.error).toBeUndefined();
    expect(r2.r).toMatchObject({ success: true, idempotent: true });
    expect(r2.r.pago_ids.sort()).toEqual(antes.filas.map((x: any) => x.pago_id).sort());
    expect(r2.r.condonacionBoletaTardia).toMatchObject({ estado: "vigente", monto: p.e.condonar.toFixed(2) });
    expect(f.filas).toEqual(antes.filas);
    expect(f.conds).toHaveLength(1);
    expect(f.hist).toEqual(antes.hist);
  }, T);

  test("2b. doble llamada CONCURRENTE (Promise.all) con el mismo intento y la misma boleta: un solo pago, una sola condonación, ninguna se cuelga", async () => {
    const p = await preparar(tomar()); usados.push(`2b:${p.credito}`);
    const [a, b] = await Promise.all([correr(p), correr(p)]);
    const f = await foto(p.credito, p.intento);
    expect(a.error ?? b.error).toBeUndefined();
    const idem = [a, b].filter((x) => x.r.idempotent === true);
    expect(idem).toHaveLength(1);
    const real = [a, b].find((x) => x.r.idempotent !== true)!;
    afirmarExito(p, f, real);
    expect(f.conds).toHaveLength(1);
    const pagos = await sql(`SELECT count(DISTINCT numeroautorizacion)::int AS n FROM cartera.pagos_credito WHERE credito_id=$1 AND numeroautorizacion=$2`, [p.credito, p.body.numeroAutorizacion]);
    expect(pagos[0].n).toBe(1);
  }, T);

  test("3. RubroError CON filas escritas (el rubro se anula entre el reparto y el reclamo): la condonación se MANTIENE", async () => {
    const p0 = await preparar(tomar()); usados.push(`3:${p0.credito}`);
    const [rubro] = await sql(
      `INSERT INTO cartera.rubros (credito_id,tipo_id,descripcion,monto_original,saldo_pendiente,activo,completado,anulado)
       VALUES ($1,1,'E2E rubro 6c',200,200,true,false,false) RETURNING rubro_id`, [p0.credito]);
    // Simula la anulación concurrente del rubro: en cuanto se inserta la fila de pago, el rubro queda anulado.
    await pool.query(`CREATE OR REPLACE FUNCTION cartera.e2e6c_anula_rubro() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE cartera.rubros SET anulado = true WHERE credito_id = NEW.credito_id AND descripcion = 'E2E rubro 6c'; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER e2e6c_anula_rubro AFTER INSERT OR UPDATE ON cartera.pagos_credito FOR EACH ROW WHEN (NEW.credito_id = ${Number(p0.credito)}) EXECUTE FUNCTION cartera.e2e6c_anula_rubro()`);
    try {
      const p = await preparar(p0.credito, { sumarMonto: 200 }); // la boleta debe cubrir también el rubro
      const res = await correr(p);
      const f = await foto(p.credito, p.intento);
      const rub = await sql(`SELECT anulado FROM cartera.rubros WHERE rubro_id=$1`, [rubro.rubro_id]);
      expect(rub[0].anulado).toBe(true); // el escenario ejerció el camino que dice ejercer
      expect(res.error).toBeUndefined();
      expect(res.status).toBe(409);
      expect(String(res.r.message)).toContain("LA BOLETA SÍ QUEDÓ REGISTRADA");
      expect(f.filas.length).toBeGreaterThan(0);
      expect(f.conds).toHaveLength(1);
      expect(f.conds[0].anulada).toBe(false);
      expect(f.sinMarca).toEqual([]);
      expect(res.r.condonacionBoletaTardia).toMatchObject({ monto: p.e.condonar.toFixed(2) });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS e2e6c_anula_rubro ON cartera.pagos_credito`);
    }
  }, T);

  test("4. fallo SIN filas (numeroAutorizacion+banco ya registrados): la condonación se ANULA y la mora se restituye", async () => {
    const p = await preparar(tomar()); usados.push(`4:${p.credito}`);
    const otro = await sql(`SELECT credito_id FROM cartera.pagos_credito WHERE credito_id <> $1 GROUP BY credito_id ORDER BY credito_id LIMIT 1`, [p.credito]);
    // Boleta previa con el mismo número y banco (en otro crédito: la sembramos con INSERT directo clonando una fila existente).
    const colsP = (await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='cartera' AND table_name='pagos_credito' AND column_name NOT IN ('pago_id','boleta_tardia_intento_id') ORDER BY ordinal_position`)).map((x: any) => `"${x.column_name}"`);
    const sel = colsP.map((c) => (c === '"credito_id"' ? "$1::int" : c === '"numeroautorizacion"' ? "$2" : c === '"banco_id"' ? "$3::int" : c)).join(",");
    await pool.query(`INSERT INTO cartera.pagos_credito (${colsP.join(",")}) SELECT ${sel} FROM cartera.pagos_credito WHERE credito_id=$1 ORDER BY pago_id LIMIT 1`, [otro[0].credito_id, p.body.numeroAutorizacion, BANCO_ID]);
    const res = await correr(p);
    const f = await foto(p.credito, p.intento);
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(409);
    expect(String(res.r.message)).toContain("ya fueron registradas");
    expect(f.filas).toEqual([]);
    expect(f.conds).toHaveLength(1);
    expect(f.conds[0].anulada).toBe(true);
    expect(f.mora.monto).toBe(Big(p.moraAntes).toFixed(2)); // mora restituida
    expect(f.mora.activa).toBe(true);
    expect(ledgerDe(f, "CONDONACION").minus(p.ledger0.CONDONACION).plus(ledgerDe(f, "ANULACION").minus(p.ledger0.ANULACION)).abs().lt("0.000001")).toBe(true);
  }, T);

  test("5. LÍNEA BASE T9: caída simulada (condonar a mano y no registrar) deja la condonación viva y SIN filas (huérfana; el barrido es T9)", async () => {
    const p = await preparar(tomar()); usados.push(`5:${p.credito}`);
    const dec = await decidirHoy9()({ credito_id: p.credito, monto_boleta: p.body.monto_boleta, fecha_boleta: p.body.fecha_boleta });
    expect(dec.aplica).toBe(true);
    const c = await condonar({
      credito_id: p.credito, montoMoraEsperado: dec.moraActiva!, monto: dec.montoCondonar,
      cuotas: dec.porCuota.map((q: any) => ({ cuota_id: q.cuota_id, monto: q.monto })),
      origen: "CONDONACION_BOLETA_TARDIA", intento_id: p.intento, usuario_email: EMAIL, motivo: "E2E 6c caída simulada",
    });
    expect(c.kind).toBe("condonada");
    const f = await foto(p.credito, p.intento);
    expect(f.conds).toHaveLength(1);
    expect(f.conds[0].anulada).toBe(false);
    expect(f.filas).toEqual([]); // ANOTADO PARA T9: viva + sin filas = huérfana que el barrido debe anular
    expect(f.mora.monto).toBe(Big(p.moraAntes).minus(p.e.condonar).toFixed(2));
    // Un reintento del mismo intento (con el lock) la reevalúa: anula la huérfana y vuelve a condonar y registrar.
    const res = await correr(p);
    const f2 = await foto(p.credito, p.intento);
    expect(res.error).toBeUndefined();
    expect(res.r.condonacionBoletaTardia.estado).toBe("vigente");
    expect(f2.conds.map((x: any) => x.anulada)).toEqual([true, false]); // la huérfana se anuló y se condonó de nuevo
    expect(f2.filas.length).toBeGreaterThan(0);
    expect(f2.filas.reduce((a: Big, x: any) => a.plus(x.mora ?? 0), Big(0)).toFixed(2)).toBe(p.e.cobrar.toFixed(2));
  }, T);

  test("6. el crédito NO queda al día (cuota vencida extra que la decisión no vio): la condonación se ANULA con estado anulada_no_quedo_al_dia", async () => {
    const p = await preparar(tomar()); usados.push(`6:${p.credito}`);
    const base = decidirHoy9();
    const cols = (await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='cartera' AND table_name='cuotas_credito' AND column_name <> 'cuota_id' ORDER BY ordinal_position`)).map((x: any) => `"${x.column_name}"`);
    const decidirYCuotaExtra = async (entrada: any) => {
      const d = await base(entrada);
      const [{ max }] = await sql(`SELECT max(numero_cuota)::int AS max FROM cartera.cuotas_credito WHERE credito_id=$1`, [p.credito]);
      const sel = cols.map((c) => (c === '"numero_cuota"' ? String(max + 1) : c === '"fecha_vencimiento"' ? `'2026-08-01'` : c === '"pagado"' ? "false" : c)).join(",");
      await pool.query(`INSERT INTO cartera.cuotas_credito (${cols.join(",")}) SELECT ${sel} FROM cartera.cuotas_credito WHERE credito_id=$1 ORDER BY numero_cuota DESC LIMIT 1`, [p.credito]);
      return d;
    };
    const res = await correr(p, deps({ decidir: decidirYCuotaExtra }));
    const f = await foto(p.credito, p.intento);
    expect(res.error).toBeUndefined();
    expect(res.r.condonacionBoletaTardia.estado).toBe("anulada_no_quedo_al_dia");
    expect(f.filas.length).toBeGreaterThan(0); // el pago SÍ quedó
    expect(f.conds).toHaveLength(1);
    expect(f.conds[0].anulada).toBe(true);
    expect(ledgerDe(f, "CONDONACION").minus(p.ledger0.CONDONACION).plus(ledgerDe(f, "ANULACION").minus(p.ledger0.ANULACION)).abs().lt("0.000001")).toBe(true);
  }, T);

  test("7a. LÍNEA BASE T8: falsePayment del pago NO anula hoy la condonación", async () => {
    const p = await preparar(tomar()); usados.push(`7a:${p.credito}`);
    { const r0 = await correr(p); afirmarExito(p, await foto(p.credito, p.intento), r0); }
    const { falsePayment } = await import("./payments");
    const antes = await foto(p.credito, p.intento);
    const out: any[] = [];
    for (const fila of antes.filas) out.push(await falsePayment(fila.pago_id, p.credito).catch((e: any) => ({ error: String(e?.message ?? e) })));
    const f = await foto(p.credito, p.intento);
    console.log(`[LINEA BASE T8 falsePayment c${p.credito}] respuestas=${JSON.stringify(out)} filas=${JSON.stringify(f.filas)} conds=${JSON.stringify(f.conds)} mora=${JSON.stringify(f.mora)}`);
    expect(f.conds).toHaveLength(1);
    expect(f.conds[0].anulada).toBe(false); // hoy NO se anula: T8 lo cambia
  }, T);

  test("7b. LÍNEA BASE T8: reversePayment del pago NO anula hoy la condonación", async () => {
    const p = await preparar(tomar()); usados.push(`7b:${p.credito}`);
    { const r0 = await correr(p); afirmarExito(p, await foto(p.credito, p.intento), r0); }
    const { reversePayment } = await import("./reversePayment");
    const antes = await foto(p.credito, p.intento);
    const out: any[] = [];
    for (const fila of antes.filas) {
      const set: { status?: number } = {};
      out.push({ status: set.status, r: await reversePayment({ body: { credito_id: p.credito, pago_id: fila.pago_id }, set }).catch((e: any) => ({ error: String(e?.message ?? e) })), st2: set.status });
    }
    const f = await foto(p.credito, p.intento);
    console.log(`[LINEA BASE T8 reversePayment c${p.credito}] respuestas=${JSON.stringify(out)} filas=${JSON.stringify(f.filas)} conds=${JSON.stringify(f.conds)} mora=${JSON.stringify(f.mora)}`);
    expect(f.conds).toHaveLength(1);
    expect(f.conds[0].anulada).toBe(false); // hoy NO se anula: T8 lo cambia
  }, T);

  test("8. revertPaymentToPending no toca la condonación", async () => {
    const p = await preparar(tomar()); usados.push(`8:${p.credito}`);
    { const r0 = await correr(p); afirmarExito(p, await foto(p.credito, p.intento), r0); }
    const { revertPaymentToPending } = await import("./revertPaymentToPending");
    const antes = await foto(p.credito, p.intento);
    const out: any[] = [];
    for (const fila of antes.filas) {
      const set: { status?: number } = {};
      const r = await revertPaymentToPending({ body: { credito_id: p.credito, pago_id: fila.pago_id }, set }).catch((e: any) => ({ error: String(e?.message ?? e) }));
      out.push({ status: set.status, r });
    }
    const f = await foto(p.credito, p.intento);
    console.log(`[revertPaymentToPending c${p.credito}] respuestas=${JSON.stringify(out)}`);
    expect(f.conds).toEqual(antes.conds);
    expect(f.mora).toEqual(antes.mora);
    expect(ledgerDe(f, "CONDONACION").toFixed(6)).toBe(ledgerDe(antes, "CONDONACION").toFixed(6));
  }, T);

  test("9. procesarMoras() real: no deshace la condonación (registrada ni huérfana) ni duplica la mora", async () => {
    const reg = await preparar(tomar()); usados.push(`9-registrado:${reg.credito}`);
    { const r0 = await correr(reg); afirmarExito(reg, await foto(reg.credito, reg.intento), r0); }
    // Crédito B: condonado a mano sin pago (la mora debe seguir = devengado − ledger).
    const b = await preparar(tomar()); usados.push(`9-huerfano:${b.credito}`);
    const dec = await decidirHoy9()({ credito_id: b.credito, monto_boleta: b.body.monto_boleta, fecha_boleta: b.body.fecha_boleta });
    await condonar({
      credito_id: b.credito, montoMoraEsperado: dec.moraActiva!, monto: dec.montoCondonar,
      cuotas: dec.porCuota.map((q: any) => ({ cuota_id: q.cuota_id, monto: q.monto })),
      origen: "CONDONACION_BOLETA_TARDIA", intento_id: b.intento, usuario_email: EMAIL, motivo: "E2E 6c cron",
    });
    const antesReg = await foto(reg.credito, reg.intento);
    const antesB = await foto(b.credito, b.intento);
    const { procesarMoras } = await import("./latefee");
    await procesarMoras();
    const dR = await foto(reg.credito, reg.intento);
    const dB = await foto(b.credito, b.intento);
    for (const [a, d] of [[antesReg, dR], [antesB, dB]] as const) {
      expect(d.conds).toEqual(a.conds);
      expect(d.conds[0].anulada).toBe(false);
      expect(ledgerDe(d, "CONDONACION").toFixed(6)).toBe(ledgerDe(a, "CONDONACION").toFixed(6));
      expect(ledgerDe(d, "ANULACION").toFixed(6)).toBe(ledgerDe(a, "ANULACION").toFixed(6));
    }
    const activas = async (c: number) => (await sql(`SELECT count(*)::int AS n FROM cartera.moras_credito WHERE credito_id=$1 AND activa`, [c]))[0].n;
    expect(await activas(reg.credito)).toBeLessThanOrEqual(1);
    expect(await activas(b.credito)).toBe(1);
    // Mora de B = devengado (a la fecha REAL del cron) − ledger de cada cuota vencida impaga, nunca la mora SIN condonar.
    const cuotasB = await sql(
      `SELECT q.cuota_id, ($2::date - q.fecha_vencimiento) AS dias, COALESCE((SELECT sum(l.monto) FROM cartera.mora_pagada_cuota l WHERE l.cuota_id=q.cuota_id),0)::text AS ledger
       FROM cartera.cuotas_credito q WHERE q.credito_id=$1 AND NOT q.pagado AND q.fecha_vencimiento < $2::date`, [b.credito, hoyReal]);
    const capital = (await sql(`SELECT capital::text AS c FROM cartera.creditos WHERE credito_id=$1`, [b.credito]))[0].c;
    const devengado = cuotasB.reduce((a: Big, q: any) => a.plus(pos(Big(capital).times("0.0112").times(Math.min(1, Number(q.dias) / 30)).minus(q.ledger))), Big(0));
    console.log(`[9] B c${b.credito}: mora antes=${antesB.mora.monto} despues=${dB.mora.monto} esperado(devengado-ledger)=${devengado.toFixed(2)}`);
    expect(Big(dB.mora.monto).minus(devengado).abs().lt("0.05")).toBe(true);
  }, 600_000);

  test("10. pago SIN el bloque condonacionBoletaTardia sobre otro crédito: sin condonación, sin marca, cobra la mora completa", async () => {
    const c = tomar(); usados.push(`10:${c}`);
    const p = await preparar(c);
    const antes = await sql(`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id=$1`, [c]);
    const { condonacionBoletaTardia: _omitido, ...sinBloque } = p.body;
    const montoTotal = Number(Big(p.moraAntes).plus(p.e.need.minus(p.e.cobrar)).toFixed(2)); // mora completa + cuotas
    const set: { status?: number } = {};
    const r: any = await insertPayment({ body: { ...sinBloque, monto_boleta: montoTotal }, set });
    expect(set.status ?? 200).toBeLessThan(400);
    expect(r.success).toBe(true);
    expect(r.condonacionBoletaTardia).toBeUndefined();
    const conds = await sql(`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id=$1`, [c]);
    expect(conds[0].n).toBe(antes[0].n);
    const filas = await sql(`SELECT mora::text AS mora, boleta_tardia_intento_id FROM cartera.pagos_credito WHERE credito_id=$1 AND numeroautorizacion=$2`, [c, p.body.numeroAutorizacion]);
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((x: any) => x.boleta_tardia_intento_id === null)).toBe(true);
    expect(filas.reduce((a: Big, x: any) => a.plus(x.mora ?? 0), Big(0)).toFixed(2)).toBe(Big(p.moraAntes).toFixed(2));
    const ledger = await sql(`SELECT COALESCE(sum(monto),0)::text AS m FROM cartera.mora_pagada_cuota WHERE credito_id=$1 AND tipo='CONDONACION'`, [c]);
    expect(Big(ledger[0].m).toFixed(6)).toBe(p.ledger0.CONDONACION.toFixed(6)); // sin ledger nuevo de condonación
  }, T);
});
