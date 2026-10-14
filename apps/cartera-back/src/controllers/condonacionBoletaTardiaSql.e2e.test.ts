import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/**
 * E2E del listado de pagos de contabilidad (Tarea 11) sobre una COPIA de datos de producción (~133 mil pagos):
 * la subconsulta `CONDONACION_BOLETA_TARDIA_SELECT_SQL` que `getPagosConInversionistas` suma a cada pago.
 *  1) RENDIMIENTO: EXPLAIN (ANALYZE) del SQL REAL del endpoint (capturado de `db.execute`) ANTES (el mismo SQL sin el
 *     fragmento: el diff de payments.ts contra 3d4b54d4e son 3 líneas, la del fragmento entre ellas) y DESPUÉS.
 *  2) CORRECCIÓN: 4 boletas tardías sembradas (viva, anulada, viva+anulada del mismo intento, intento reusado en otro
 *     crédito); la insignia sale solo en su pago, null en el resto; total y orden idénticos antes/después.
 *
 * Se salta si falta E2E_DB_URL. Preparación (copia descartable, nunca la base de PROD):
 *   docker exec cartera-local createdb -U postgres -T prod20261009 e2e_bt_t11b
 *   (aplicar drizzle/0053, 0054, 0055 y 0056 con `docker exec -i cartera-local psql -U postgres -d e2e_bt_t11b -v ON_ERROR_STOP=1 -f - < archivo`)
 *   E2E_DB_URL=postgres://postgres:<pw>@localhost:5433/e2e_bt_t11b bun test src/controllers/condonacionBoletaTardiaSql.e2e.test.ts
 *   docker exec cartera-local dropdb -U postgres e2e_bt_t11b
 */
const E2E_DB_URL = process.env.E2E_DB_URL;
const PROD_SYSTEM_IDENTIFIER = "7473814220388481052";
const DB_ESPERADA = "e2e_bt_t11b";

// Antes de CUALQUIER import de la app: `database/index.ts` lee SUPABASE_DB_URL al cargarse.
if (E2E_DB_URL) process.env.SUPABASE_DB_URL = E2E_DB_URL;
process.env.RESEND_API_KEY ??= "e2e-inerte";
process.env.EMAIL_DOMAIN ??= "e2e.invalid";

const suite = E2E_DB_URL ? describe : describe.skip;

const U_VIVA = "00000000-0000-4000-8000-0000000b7101";
const U_ANULADA = "00000000-0000-4000-8000-0000000b7102";
const U_MIXTA = "00000000-0000-4000-8000-0000000b7103";

let pool: any; // `pg` sin tipos en este paquete
let listar: typeof import("./payments").getPagosConInversionistas;
let capturas: { text: string; params: unknown[] }[] = [];
let ordenFijo = false; // true: ambos SQL con desempate por pago_id (el ORDER BY real es inestable entre corridas)
let modoAntes = false; // true: el listado corre el MISMO SQL sin el fragmento (= el SQL de 3d4b54d4e)
let asesor: { id: number; email: string };
let usados: { viva: number; anulada: number; mixta: number; reuso: number } | undefined;
let monto: Record<string, string> = {};

const FRAGMENTO = /\(\s*SELECT json_build_object\('condonacionId'[\s\S]*?AS "condonacionBoletaTardia",/;

/** Llama al listado REAL y devuelve su resultado + el SQL principal (el 2º que ejecuta) con sus parámetros. */
async function listadoReal(opts: Record<string, unknown>) {
  capturas = [];
  const res = await listar({ page: 1, pageSize: 10, ...opts } as any);
  const principal = capturas[1]!;
  const conteo = capturas[0]!;
  expect(principal.text).toContain('AS "condonacionBoletaTardia"');
  return { res, principal, conteo };
}
const sinFragmento = (texto: string) => {
  expect(FRAGMENTO.test(texto)).toBe(true);
  return texto.replace(FRAGMENTO, "");
};
/**
 * El `ORDER BY p.fecha_pago DESC` del endpoint NO es determinista (104 mil de 133 mil pagos tienen fecha_pago NULL y
 * hay 1.637 fechas repetidas): dos corridas del MISMO SQL pueden permutar los empatados. Para comparar ANTES/DESPUÉS
 * se fija el desempate (`pago_id`) en AMBOS textos.
 */
const determinista = (texto: string) => {
  expect(texto).toContain("ORDER BY p.fecha_pago DESC");
  return texto.replace("ORDER BY p.fecha_pago DESC", "ORDER BY p.fecha_pago DESC, p.pago_id DESC");
};
const idsDe = (rows: any[]) => rows.map((r) => Number(r.pagoId));
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function planJson(texto: string, params: unknown[]) {
  const r = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + texto, params);
  const plan = r.rows[0]["QUERY PLAN"][0];
  return { ms: Number(plan["Execution Time"]), plan: plan.Plan };
}
/** Nodos Seq Scan sobre `relacion` que SÍ se ejecutaron (Actual Loops > 0). */
function seqScansEjecutados(nodo: any, relacion: string, acc: any[] = []): any[] {
  if (nodo["Node Type"] === "Seq Scan" && nodo["Relation Name"] === relacion && Number(nodo["Actual Loops"]) > 0) acc.push(nodo);
  for (const h of nodo.Plans ?? []) seqScansEjecutados(h, relacion, acc);
  return acc;
}

suite("listado de pagos de contabilidad + condonación de boleta tardía sobre la copia de PROD", () => {
  beforeAll(async () => {
    // --- Guardas de seguridad: ABORTAN antes de tocar nada ---
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

    // Captura el SQL que arma el endpoint (sin alterarlo) para correr EXPLAIN sobre ESE texto.
    const db: any = database.db;
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const original = db.execute.bind(db);
    db.execute = (q: any) => {
      let r: { sql: string; params: unknown[] } | undefined;
      try { r = dialect.sqlToQuery(q); capturas.push({ text: r.sql, params: r.params }); } catch { /* no es sql`` de drizzle */ }
      if (r && FRAGMENTO.test(r.sql) && (modoAntes || ordenFijo)) {
        let texto = modoAntes ? r.sql.replace(FRAGMENTO, "") : r.sql;
        if (ordenFijo) texto = texto.replace("ORDER BY p.fecha_pago DESC", "ORDER BY p.fecha_pago DESC, p.pago_id DESC");
        return pool.query(texto, r.params);
      }
      return original(q);
    };
    ({ getPagosConInversionistas: listar } = await import("./payments"));
    asesor = (await pool.query(`SELECT id, email FROM cartera.platform_users ORDER BY id LIMIT 1`)).rows[0];

    const restos = await pool.query(`SELECT count(*)::int AS n FROM cartera.pagos_credito WHERE boleta_tardia_intento_id IN ($1,$2,$3)`, [U_VIVA, U_ANULADA, U_MIXTA]);
    if (restos.rows[0].n !== 0) throw new Error("la copia ya tiene datos sembrados; recréala");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`UPDATE cartera.pagos_credito SET boleta_tardia_intento_id = NULL WHERE boleta_tardia_intento_id IN (SELECT intento_id FROM cartera.moras_condonaciones WHERE motivo = 'e2e t11 estres')`);
    await pool.query(`DELETE FROM cartera.moras_condonaciones WHERE motivo = 'e2e t11 estres'`);
    await pool.query(`UPDATE cartera.pagos_credito SET boleta_tardia_intento_id = NULL WHERE boleta_tardia_intento_id IN ($1,$2,$3)`, [U_VIVA, U_ANULADA, U_MIXTA]);
    await pool.query(`DELETE FROM cartera.moras_condonaciones WHERE intento_id IN ($1,$2,$3)`, [U_VIVA, U_ANULADA, U_MIXTA]);
  });

  test("0) baseline sin siembra: ningún pago trae insignia, mismo total y mismo orden que sin el fragmento", async () => {
    const { res, principal, conteo } = await listadoReal({ pageSize: 500 });
    expect(res.data.length).toBe(500);
    expect(res.data.every((p: any) => p.condonacionBoletaTardia === null)).toBe(true);
    const antes = await pool.query(determinista(sinFragmento(principal.text)), principal.params);
    const despues = await pool.query(determinista(principal.text), principal.params);
    expect(idsDe(despues.rows)).toEqual(idsDe(antes.rows));
    expect(despues.rows.every((r: any) => r.condonacionBoletaTardia === null)).toBe(true);
    // el orden real solo difiere de ANTES entre empatados de fecha_pago (mismo conjunto de fechas en el mismo orden)
    const fechas = (rows: any[]) => rows.map((r) => r.fechaPago);
    expect(fechas(res.data)).toEqual(fechas(antes.rows));
    const total = Number((await pool.query(conteo.text, conteo.params)).rows[0].total);
    expect(res.total).toBe(total);
  }, 120_000);

  test("1) siembra: la insignia sale solo en los pagos con condonación viva; null en el resto; total y orden idénticos", async () => {
    // Pagos de la primera página real, de créditos distintos y con mora (moras_condonaciones.mora_id es obligatorio).
    const base = await listadoReal({ pageSize: 500 });
    // (orden determinista: los sembrados quedan siempre dentro de las primeras 500 filas, sea cual sea el desempate)
    const idsBase = idsDe((await pool.query(determinista(base.principal.text), base.principal.params)).rows);
    const candidatos = (await pool.query(
      `SELECT p.pago_id, p.credito_id, (SELECT m.mora_id FROM cartera.moras_credito m WHERE m.credito_id=p.credito_id ORDER BY m.mora_id DESC LIMIT 1) AS mora_id
       FROM cartera.pagos_credito p WHERE p.pago_id = ANY($1::int[])`, [idsBase])).rows
      .filter((r: any) => r.mora_id !== null);
    const porCredito = new Map<number, any>();
    for (const c of candidatos) if (!porCredito.has(c.credito_id)) porCredito.set(c.credito_id, c);
    const [pv, pa, pm, pr] = [...porCredito.values()];
    expect(pr).toBeDefined();
    usados = { viva: pv.pago_id, anulada: pa.pago_id, mixta: pm.pago_id, reuso: pr.pago_id };

    const condonar = async (c: any, intento: string, montoTxt: string, anulada: boolean) =>
      (await pool.query(
        `INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, monto_condonacion, usuario_id, intento_id, anulada_at)
         VALUES ($1,$2,'e2e t11',$3,$4,$5,${anulada ? "now()" : "NULL"}) RETURNING condonacion_id`,
        [c.credito_id, c.mora_id, montoTxt, asesor.id, intento])).rows[0].condonacion_id as number;
    const ids: Record<string, number> = {};
    ids.viva = await condonar(pv, U_VIVA, "7.47", false);
    ids.anulada = await condonar(pa, U_ANULADA, "3.20", true);
    ids.mixtaViva = await condonar(pm, U_MIXTA, "11.20", false);          // viva primero (id menor)...
    ids.mixtaAnulada = await condonar(pm, U_MIXTA, "9.99", true);         // ...y la anulada DESPUÉS (id mayor): debe ganar la viva
    monto = { viva: "7.47", mixta: "11.20" };
    await pool.query(`UPDATE cartera.pagos_credito SET boleta_tardia_intento_id=$2 WHERE pago_id=$1`, [pv.pago_id, U_VIVA]);
    await pool.query(`UPDATE cartera.pagos_credito SET boleta_tardia_intento_id=$2 WHERE pago_id=$1`, [pa.pago_id, U_ANULADA]);
    await pool.query(`UPDATE cartera.pagos_credito SET boleta_tardia_intento_id=$2 WHERE pago_id=$1`, [pm.pago_id, U_MIXTA]);
    // intento REUSADO en otro crédito (enmienda E-12): su condonación es del crédito de `pv`, no del de `pr`
    await pool.query(`UPDATE cartera.pagos_credito SET boleta_tardia_intento_id=$2 WHERE pago_id=$1`, [pr.pago_id, U_VIVA]);
    await pool.query(`ANALYZE cartera.moras_condonaciones`);

    const { res, principal, conteo } = await listadoReal({ pageSize: 500 });
    const porPago = new Map<number, any>(res.data.map((p: any) => [Number(p.pagoId), p.condonacionBoletaTardia]));
    expect(porPago.get(pv.pago_id)).toMatchObject({ condonacionId: ids.viva, monto: "7.47", asesor: asesor.email });
    expect(porPago.get(pv.pago_id).anulada).toBe(false);
    expect(porPago.get(pa.pago_id)).toMatchObject({ condonacionId: ids.anulada, monto: "3.20", asesor: asesor.email, anulada: true });
    expect(porPago.get(pm.pago_id)).toMatchObject({ condonacionId: ids.mixtaViva, monto: "11.20", anulada: false });
    expect(porPago.get(pr.pago_id)).toBeNull();
    const conInsignia = [...porPago.entries()].filter(([, v]) => v !== null).map(([k]) => k).sort((a, b) => a - b);
    expect(conInsignia).toEqual([pv.pago_id, pa.pago_id, pm.pago_id].sort((a, b) => a - b));

    // ANTES vs DESPUÉS: mismas filas, mismo orden, mismo total, y cada columna previa idéntica.
    const antes = await pool.query(determinista(sinFragmento(principal.text)), principal.params);
    const despues = await pool.query(determinista(principal.text), principal.params);
    expect(idsDe(despues.rows)).toEqual(idsDe(antes.rows));
    expect(despues.rows.length).toBe(antes.rows.length);
    for (let i = 0; i < antes.rows.length; i++) {
      const { condonacionBoletaTardia: _omitida, ...resto } = despues.rows[i];
      expect(resto).toEqual(antes.rows[i]);
    }
    expect(res.total).toBe(Number((await pool.query(conteo.text, conteo.params)).rows[0].total));
    expect(res.total).toBe(base.res.total);

    // con filtros del front (estado, crédito): la insignia sigue donde toca y el conteo no cambia
    // Por crédito el resultado cabe entero en la página: mismo conjunto de pagos y de fechas que ANTES.
    for (const c of [pv, pa, pm, pr]) {
      const numero = (await pool.query(`SELECT numero_credito_sifco AS n FROM cartera.creditos WHERE credito_id=$1`, [c.credito_id])).rows[0].n;
      const f = await listadoReal({ pageSize: 500, numeroCredito: numero });
      const fa = await pool.query(sinFragmento(f.principal.text), f.principal.params);
      expect(idsDe(f.res.data).sort((a, b) => a - b)).toEqual(idsDe(fa.rows).sort((a, b) => a - b));
      expect(f.res.data.map((p: any) => p.fechaPago)).toEqual(fa.rows.map((r: any) => r.fechaPago));
      expect(f.res.total).toBe(fa.rows.length);
      for (const p of f.res.data) {
        const esperado = Number(p.pagoId) === pv.pago_id ? "viva" : Number(p.pagoId) === pa.pago_id ? "anulada" : Number(p.pagoId) === pm.pago_id ? "viva" : null;
        if (esperado === null) expect(p.condonacionBoletaTardia).toBeNull();
        else expect((p.condonacionBoletaTardia as { anulada: boolean }).anulada).toBe(esperado === "anulada");
      }
    }
  }, 180_000);

  test("2) rendimiento: DESPUÉS no es >20% más lento y la subconsulta no hace seq scan por fila (página por defecto y página de 500 con los 4 sembrados)", async () => {
    expect(usados).toBeDefined();
    const estres = async () => { // 300 de las primeras 500 filas (orden determinista) con intento; 30% anuladas
      const top = await listadoReal({ page: 1, pageSize: 500 });
      await pool.query(
        `WITH top AS (SELECT p.pago_id, p.credito_id, (SELECT m.mora_id FROM cartera.moras_credito m WHERE m.credito_id=p.credito_id LIMIT 1) mora
           FROM cartera.pagos_credito p WHERE p.pago_id = ANY($1::int[]) AND p.boleta_tardia_intento_id IS NULL),
         sel AS (SELECT pago_id, credito_id, mora, gen_random_uuid() AS u FROM top WHERE mora IS NOT NULL LIMIT 300),
         ins AS (INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, monto_condonacion, usuario_id, intento_id, anulada_at)
           SELECT credito_id, mora, 'e2e t11 estres', 5, $2, u, CASE WHEN random()<0.3 THEN now() END FROM sel RETURNING 1)
         UPDATE cartera.pagos_credito p SET boleta_tardia_intento_id = sel.u FROM sel WHERE p.pago_id = sel.pago_id`,
        [idsDe((await pool.query(determinista(top.principal.text), top.principal.params)).rows), asesor.id]);
      await pool.query(`ANALYZE cartera.moras_condonaciones`); await pool.query(`ANALYZE cartera.pagos_credito`);
    };
    for (const [nombre, pageSize] of [["página por defecto (10 filas)", 10], ["página de 500 filas con los 4 sembrados", 500], ["ESTRÉS: 500 filas, ~300 con intento", -500]] as const) {
      if (pageSize < 0) await estres();
      const pageSize2 = Math.abs(pageSize);
      const { principal } = await listadoReal({ page: 1, pageSize: pageSize2 });
      const texto = determinista(principal.text); // mismas filas en ambos; el SQL real solo difiere en el desempate
      const antesTxt = sinFragmento(texto);
      const tA: number[] = [], tD: number[] = [];
      let planD: any;
      for (let i = 0; i < 7; i++) {
        tA.push((await planJson(antesTxt, principal.params)).ms);
        const d = await planJson(texto, principal.params);
        tD.push(d.ms); planD = d.plan;
      }
      const seqMc = seqScansEjecutados(planD, "moras_condonaciones");
      console.log(`EXPLAIN ${nombre}: ANTES mediana=${mediana(tA).toFixed(1)}ms DESPUÉS mediana=${mediana(tD).toFixed(1)}ms; ` +
        `Seq Scan ejecutados sobre moras_condonaciones: ${seqMc.map((n) => `loops=${n["Actual Loops"]}`).join(",") || "ninguno"}`);
      expect(mediana(tD)).toBeLessThanOrEqual(mediana(tA) * 1.2 + 2);
      expect(seqMc).toEqual([]);
      expect(seqScansEjecutados(planD, "pagos_credito").filter((n: any) => n["Parent Relationship"] === "SubPlan")).toEqual([]);
    }
  }, 180_000);

  test("3) los Excel de contabilidad (inversionistas y asesores) reusan la consulta y su salida no cambia", async () => {
    expect(usados).toBeDefined();
    const ExcelJS = (await import("exceljs")).default;
    const { S3Client } = await import("@aws-sdk/client-s3");
    const reportes = await import("./reports");
    // Sin red: el subido a R2 se anula; las hojas se capturan en memoria al crearlas.
    const envio = S3Client.prototype.send;
    const addWorksheet = ExcelJS.Workbook.prototype.addWorksheet;
    let hojas: any[] = [];
    (S3Client.prototype as any).send = async () => ({});
    (ExcelJS.Workbook.prototype as any).addWorksheet = function (...args: any[]) { const h = (addWorksheet as any).apply(this, args); hojas.push(h); return h; };
    const numeros: string[] = [];
    for (const id of [usados!.viva, usados!.anulada, usados!.mixta, usados!.reuso]) {
      numeros.push((await pool.query(`SELECT c.numero_credito_sifco AS n FROM cartera.pagos_credito p JOIN cartera.creditos c USING (credito_id) WHERE p.pago_id=$1`, [id])).rows[0].n);
    }
    const volcar = () => JSON.stringify(hojas.map((h) => ({ nombre: h.name, valores: h.getSheetValues() })));
    ordenFijo = true;
    try {
      for (const exportar of [reportes.exportPagosConInversionistasExcel, reportes.exportPagosAdvisorExcel]) {
        for (const filtro of [...numeros.map((numeroCredito) => ({ numeroCredito })), { fechaInicio: "2026-10-01", fechaFin: "2026-10-09" }]) {
          modoAntes = true; hojas = [];
          const a = await exportar(filtro as any);
          const antes = volcar();
          modoAntes = false; hojas = [];
          const d = await exportar(filtro as any);
          const despues = volcar();
          expect(d.total).toBe(a.total);
          expect(d.total).toBeGreaterThan(0);
          expect(despues).toBe(antes);
        }
      }
    } finally {
      modoAntes = false; ordenFijo = false;
      (S3Client.prototype as any).send = envio;
      (ExcelJS.Workbook.prototype as any).addWorksheet = addWorksheet;
    }
  }, 300_000);
});
