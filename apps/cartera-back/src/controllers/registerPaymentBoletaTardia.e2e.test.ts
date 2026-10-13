import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

/**
 * E2E de la marca `boleta_tardia_intento_id` (Tarea 4): `insertPayment` REAL (sin fakes) sobre una COPIA de datos de
 * producción. El riesgo nº1 del proyecto: una fila de `pagos_credito` que la boleta escribe y NO queda marcada deja
 * la condonación "huérfana" con el pago vivo.
 *
 * Se salta si falta E2E_DB_URL. Preparación (copia descartable, nunca la base de PROD):
 *   docker exec cartera-local createdb -U postgres -T prod20261009 e2e_bt_t4
 *   (aplicar 0053 fuera de tx, 0054 y 0055 con psql -f -)
 *   E2E_DB_URL=postgres://postgres:<pw>@localhost:5433/e2e_bt_t4 bun test src/controllers/registerPaymentBoletaTardia.e2e.test.ts
 *   docker exec cartera-local dropdb -U postgres e2e_bt_t4
 * Las pruebas ESCRIBEN en esa base; los créditos están elegidos para esa copia (prod20261009).
 */
const E2E_DB_URL = process.env.E2E_DB_URL;
const PROD_SYSTEM_IDENTIFIER = "7473814220388481052";
const DBS_ESPERADAS = ["e2e_bt_t4", "e2e_bt_t4b"];

// Antes de CUALQUIER import de la app: `database/index.ts` lee SUPABASE_DB_URL al cargarse.
if (E2E_DB_URL) process.env.SUPABASE_DB_URL = E2E_DB_URL;
// El paquete de email exige estas variables al importarse; valores inertes (la prueba no envía correo).
process.env.RESEND_API_KEY ??= "e2e-inerte";
process.env.EMAIL_DOMAIN ??= "e2e.invalid";

const suite = E2E_DB_URL ? describe : describe.skip;

// `pg` no trae tipos en este paquete (mismo caso que database/index.ts): el pool se tipa suelto.
let pool: any;
let insertPayment: typeof import("./registerPayment").insertPayment;
let BANCO_ID = 0;

const hoy = new Date().toISOString().slice(0, 10);

type Fila = Record<string, any>;
const snapshot = async (creditoId: number): Promise<Map<number, Fila>> => {
  const r = await pool.query(
    `SELECT to_jsonb(p) AS j FROM cartera.pagos_credito p WHERE p.credito_id = $1`,
    [creditoId],
  );
  return new Map(r.rows.map((x: any) => [x.j.pago_id as number, x.j as Fila]));
};

interface Escenario {
  nombre: string;
  intento: number; // crédito con intento
  control: number; // crédito de control, mismo tipo de pago SIN intento
  /** Prepara datos en la copia (p. ej. un rubro) y devuelve el body parcial para ese crédito. */
  armar: (creditoId: number) => Promise<{ monto: number; otros?: number; abono?: number }>;
  /** Aserciones propias del escenario sobre las filas de la boleta. */
  verificar?: (r: { delaBoleta: Fila[] }, conIntento: boolean) => void;
}

const cuotaDe = async (id: number) =>
  Number((await pool.query(`SELECT cuota FROM cartera.creditos WHERE credito_id=$1`, [id])).rows[0].cuota);
const moraDe = async (id: number) =>
  Number(
    (await pool.query(`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id=$1 AND activa`, [id])).rows[0]
      .monto_mora,
  );
const crearRubro = async (id: number, monto: number) => {
  await pool.query(
    `INSERT INTO cartera.rubros (credito_id,tipo_id,descripcion,monto_original,saldo_pendiente,activo,completado,anulado)
     VALUES ($1,1,'E2E rubro',$2,$2,true,false,false)`,
    [id, monto],
  );
};
/**
 * Deja la primera cuota abierta como queda tras un pago parcial real: el placeholder `no_required` YA CONSUMIDO
 * (pasa a `validated` con parte aplicada). La copia de PROD no trae ningún crédito así, y es el único estado donde el
 * cierre INSERTA una fila nueva en vez de reutilizar el placeholder con UPDATE.
 */
const consumirPlaceholder = async (id: number) => {
  const r = await pool.query(
    `UPDATE cartera.pagos_credito p SET validation_status='validated', pagado=false, monto_aplicado=100, monto_boleta=100
     WHERE p.pago_id = (SELECT p2.pago_id FROM cartera.pagos_credito p2 JOIN cartera.cuotas_credito q ON q.cuota_id=p2.cuota_id
       WHERE q.credito_id=$1 AND NOT q.pagado AND p2.validation_status='no_required'
       ORDER BY q.numero_cuota LIMIT 1) RETURNING p.pago_id`,
    [id],
  );
  if (r.rowCount !== 1) throw new Error(`crédito ${id} sin placeholder no_required que consumir`);
};
/** Deja la primera cuota abierta con su placeholder no_required ANULADO (paymentFalse=true) y, opcional, con una marca vieja. */
const prepararPlaceholder = async (id: number, o: { anulado?: boolean; marcaVieja?: string }) => {
  const r = await pool.query(
    `UPDATE cartera.pagos_credito p SET "paymentFalse"=COALESCE($2,p."paymentFalse"), boleta_tardia_intento_id=COALESCE($3::uuid,p.boleta_tardia_intento_id)
     WHERE p.pago_id = (SELECT p2.pago_id FROM cartera.pagos_credito p2 JOIN cartera.cuotas_credito q ON q.cuota_id=p2.cuota_id
       WHERE q.credito_id=$1 AND NOT q.pagado AND p2.validation_status='no_required' ORDER BY q.numero_cuota LIMIT 1) RETURNING p.pago_id`,
    [id, o.anulado ?? null, o.marcaVieja ?? null],
  );
  if (r.rowCount !== 1) throw new Error(`crédito ${id} sin placeholder`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

const ESCENARIOS: Escenario[] = [
  { nombre: "a) cubre exactamente 1 cuota (UPDATE del placeholder no_required)", intento: 8741, control: 9152,
    armar: async (id) => ({ monto: await cuotaDe(id) }) },
  { nombre: "b) cubre 2 cuotas", intento: 9394, control: 9405,
    armar: async (id) => ({ monto: r2((await cuotaDe(id)) * 2) }) },
  { nombre: "c) mora activa + cuota", intento: 666, control: 1001,
    armar: async (id) => ({ monto: r2((await moraDe(id)) + (await cuotaDe(id))) }) },
  { nombre: "c2) paga la mora exacta (sin sobrante)", intento: 518, control: 701,
    armar: async (id) => ({ monto: await moraDe(id) }) },
  { nombre: "i) no alcanza ni la mora (solo mora parcial)", intento: 887, control: 951,
    armar: async (id) => ({ monto: r2((await moraDe(id)) / 2) }) },
  { nombre: "d) cuota + otros", intento: 9180, control: 9201,
    armar: async (id) => ({ monto: r2((await cuotaDe(id)) + 500), otros: 500 }) },
  { nombre: "d2) solo otros (boleta == otros)", intento: 8925, control: 8685,
    armar: async () => ({ monto: 300, otros: 300 }) },
  { nombre: "e) excedente a saldo a favor (crédito con 1 cuota abierta)", intento: 8860, control: 105,
    armar: async (id) => ({ monto: r2((await cuotaDe(id)) * 3) }) },
  { nombre: "f1) abono directo a capital puro", intento: 8871, control: 9414,
    armar: async () => ({ monto: 1000, abono: 1000 }) },
  { nombre: "f2) cuota + abono a capital", intento: 8818, control: 525,
    armar: async (id) => ({ monto: r2((await cuotaDe(id)) + 1000), abono: 1000 }) },
  { nombre: "g1) cierra una cuota con fila parcial previa (INSERT de fila de cierre)", intento: 999, control: 957,
    armar: async (id) => ({ monto: await cuotaDe(id) }) },
  { nombre: "g3) cierre con el placeholder ya consumido (INSERT de fila de cierre, no UPDATE)", intento: 221, control: 60,
    armar: async (id) => { await consumirPlaceholder(id); return { monto: await cuotaDe(id) }; } },
  { nombre: "g2) pago parcial sobre cuota con fila parcial previa (INSERT parcial)", intento: 258, control: 641,
    armar: async () => ({ monto: 100 }) },
  { nombre: "h1) cuota + rubros", intento: 9027, control: 9477,
    armar: async (id) => { await crearRubro(id, 200); return { monto: r2((await cuotaDe(id)) + 200) }; } },
  { nombre: "h2) boleta == rubro (ninguna cuota escribe: fila-rastro)", intento: 9233, control: 761,
    armar: async (id) => { await crearRubro(id, 150); return { monto: 150 }; } },
  // k) Antes: la fila de la boleta HEREDABA paymentFalse del placeholder anulado (sin intento sigue igual: nace anulada
  // y por eso el crédito no ve el pago). Con intento nace viva (F3), si no la condonación/compensación no la vería.
  { nombre: "k) placeholder anulado (paymentFalse=true): con intento nace viva; sin intento hereda true (comportamiento previo)", intento: 8974, control: 9583,
    armar: async (id) => { await prepararPlaceholder(id, { anulado: true }); return { monto: await cuotaDe(id) }; },
    verificar: (r, conIntento) => {
      expect(r.delaBoleta.length).toBeGreaterThan(0);
      expect(r.delaBoleta.every((f) => f.paymentFalse === !conIntento)).toBe(true);
    } },
  // l) Un pago normal (sin intento) que reutiliza con UPDATE un placeholder con marca vieja la BORRA (F4).
  { nombre: "l) placeholder con marca vieja: la reutiliza un pago normal y la marca queda NULL", intento: 9576, control: 9494,
    armar: async (id) => { await prepararPlaceholder(id, { marcaVieja: randomUUID() }); return { monto: await cuotaDe(id) }; },
    verificar: (r, conIntento) => {
      expect(r.delaBoleta.length).toBeGreaterThan(0);
      if (!conIntento) expect(r.delaBoleta.every((f) => f.boleta_tardia_intento_id === null)).toBe(true);
    } },
  { nombre: "j) crédito EN_CONVENIO", intento: 8914, control: 156,
    armar: async (id) => ({ monto: await cuotaDe(id) }) },
];

/** Prueba que el escenario ejerció el camino que dice ejercer (si no, la marca no se probó donde importa). */
async function efectoDeNegocio(nombre: string, creditoId: number, r: Awaited<ReturnType<typeof ejecutar>>, _i: string) {
  const filas = [...r.despues.values()].filter((f) => r.delaBoleta.some((d) => d.pago_id === f.pago_id));
  if (nombre.startsWith("h")) {
    const n = (
      await pool.query(
        `SELECT count(*)::int n FROM cartera.rubros_pagos rp JOIN cartera.rubros r USING (rubro_id) WHERE r.credito_id=$1`,
        [creditoId],
      )
    ).rows[0].n;
    expect(n).toBeGreaterThan(0);
  }
  if (nombre.startsWith("e)")) {
    expect(Number(filas.length)).toBeGreaterThan(0);
    const s = await pool.query(
      `SELECT u.saldo_a_favor FROM cartera.usuarios u JOIN cartera.creditos c USING (usuario_id) WHERE c.credito_id=$1`,
      [creditoId],
    );
    expect(Number(s.rows[0].saldo_a_favor)).toBeGreaterThan(0);
  }
  if (nombre.startsWith("c)") || nombre.startsWith("c2") || nombre.startsWith("i)")) {
    expect(filas.some((f) => Number(f.mora) > 0)).toBe(true);
  }
  if (nombre.startsWith("f")) expect(filas.some((f) => f.validation_status === "capital" || f.validationStatus === "capital")).toBe(true);
}

async function ejecutar(creditoId: number, e: { monto: number; otros?: number; abono?: number }, intentoId?: string) {
  const u = await pool.query(`SELECT usuario_id FROM cartera.creditos WHERE credito_id=$1`, [creditoId]);
  const auth = `E2E-${randomUUID()}`;
  const antes = await snapshot(creditoId);
  const inicio = (await pool.query(`SELECT now() AS t`)).rows[0].t as Date;
  const set: { status?: number } = {};
  const body = {
    credito_id: creditoId,
    usuario_id: u.rows[0].usuario_id,
    monto_boleta: e.monto,
    fecha_pago: hoy,
    fecha_boleta: hoy,
    cuotaApagar: 1,
    url_boletas: [],
    banco_id: BANCO_ID,
    numeroAutorizacion: auth,
    registerBy: "E2E",
    otros: e.otros,
    abono_directo_capital: e.abono,
  };
  const res = await insertPayment({ body, set }, intentoId ? { boletaTardiaIntentoId: intentoId } : {});
  const despues = await snapshot(creditoId);
  const nuevas = [...despues.values()].filter((f) => !antes.has(f.pago_id));
  const cambiadas = [...despues.values()].filter(
    (f) => antes.has(f.pago_id) && JSON.stringify(antes.get(f.pago_id)) !== JSON.stringify(f),
  );
  // "De ESTA boleta": filas nuevas, o filas (nuevas o reutilizadas con UPDATE) que llevan su numeroAutorizacion.
  const delaBoleta = [...despues.values()].filter(
    (f) => !antes.has(f.pago_id) || f.numeroautorizacion === auth,
  );
  const vivasDesde = (
    await pool.query(
      `SELECT pago_id FROM cartera.pagos_credito WHERE credito_id=$1 AND "paymentFalse"=false AND createdat >= $2`,
      [creditoId, inicio],
    )
  ).rows.map((r: any) => r.pago_id as number);
  return { res, set, auth, nuevas, cambiadas, delaBoleta, vivasDesde, despues };
}

suite("insertPayment E2E: boletaTardiaIntentoId marca TODA fila que escribe la boleta (copia de PROD)", () => {
  beforeAll(async () => {
    // --- Guardas de seguridad: ABORTAN antes de escribir nada ---
    const u = new URL(E2E_DB_URL!);
    if (!(u.hostname === "localhost" && u.port === "5433")) throw new Error(`E2E_DB_URL no es localhost:5433 (${u.host})`);
    if (!DBS_ESPERADAS.some((d) => u.pathname === `/${d}`)) throw new Error(`La base no es ${DBS_ESPERADAS}: ${u.pathname}`);
    const database = await import("../database");
    // La conexión EFECTIVA de la app es esa (no una que haya quedado de un .env).
    const efectiva = (database.client as any).options?.connectionString as string;
    if (efectiva !== E2E_DB_URL) throw new Error("La app NO apunta a E2E_DB_URL; aborto");
    pool = database.client;
    const ident = (await pool.query(`SELECT system_identifier::text AS s FROM pg_control_system()`)).rows[0].s;
    if (ident === PROD_SYSTEM_IDENTIFIER) throw new Error("system_identifier de PROD; aborto");
    const cur = (await pool.query(`SELECT current_database() AS d`)).rows[0].d;
    if (!DBS_ESPERADAS.includes(cur)) throw new Error(`current_database=${cur}; aborto`);
    const col = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='cartera' AND table_name='pagos_credito' AND column_name='boleta_tardia_intento_id'`,
    );
    if (col.rowCount !== 1) throw new Error("Falta la migración 0054 en la copia");
    ({ insertPayment } = await import("./registerPayment"));
    BANCO_ID = (await pool.query(`SELECT banco_id FROM cartera.bancos ORDER BY banco_id LIMIT 1`)).rows[0].banco_id;
  });

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const database = await import("../database");
    await database.lockPool.end().catch(() => {});
  });

  for (const esc of ESCENARIOS) {
    test(`${esc.nombre}: con intento, toda fila de la boleta queda marcada`, async () => {
      const intentoId = randomUUID();
      const monto = await esc.armar(esc.intento);
      const r = await ejecutar(esc.intento, monto, intentoId);
      const resumen = {
        status: r.set.status ?? 200,
        nuevas: r.nuevas.map((f) => ({ id: f.pago_id, st: f.validationStatus ?? f.validation_status, n: f.numero_cuota, ap: f.monto_aplicado, otros: f.otros, mora: f.mora, m: f.boleta_tardia_intento_id ? "SI" : "NO" })),
        reutilizadas: r.cambiadas.filter((f) => f.numeroautorizacion === r.auth).map((f) => f.pago_id),
        otrasCambiadas: r.cambiadas.filter((f) => f.numeroautorizacion !== r.auth).length,
      };
      console.log(`[E2E ${esc.nombre}] ${JSON.stringify(resumen)}`);
      // El escenario tiene que haber escrito algo; si no, la prueba no probó nada.
      expect(r.set.status ?? 200).toBeLessThan(400);
      expect(r.delaBoleta.length).toBeGreaterThan(0);
      await efectoDeNegocio(esc.nombre, esc.intento, r, intentoId);
      esc.verificar?.(r, true);
      // Núcleo: ninguna fila de la boleta (nueva o reutilizada por UPDATE) sin marcar, y con el intento EXACTO.
      const sinMarca = r.delaBoleta.filter((f) => f.boleta_tardia_intento_id !== intentoId).map((f) => f.pago_id);
      expect(sinMarca).toEqual([]);
      // Conteo pedido: filas vivas creadas en la boleta == filas marcadas con el intento (en el crédito).
      const marcadas: number[] = (
        await pool.query(`SELECT pago_id FROM cartera.pagos_credito WHERE credito_id=$1 AND boleta_tardia_intento_id=$2`, [
          esc.intento,
          intentoId,
        ])
      ).rows.map((x: any) => x.pago_id as number);
      const vivasMarcadas = r.vivasDesde.filter((id: number) => marcadas.includes(id));
      expect(vivasMarcadas.length).toBe(r.vivasDesde.length);
      // No se marca nada que no sea de la boleta.
      const ids = new Set(r.delaBoleta.map((f) => f.pago_id));
      expect(marcadas.filter((id: number) => !ids.has(id))).toEqual([]);
    }, 60_000);

    test(`${esc.nombre}: CONTROL sin intento, ninguna fila marcada`, async () => {
      const monto = await esc.armar(esc.control);
      const r = await ejecutar(esc.control, monto, undefined);
      expect(r.set.status ?? 200).toBeLessThan(400);
      expect(r.delaBoleta.length).toBeGreaterThan(0);
      expect(r.delaBoleta.filter((f) => f.boleta_tardia_intento_id !== null)).toEqual([]);
      esc.verificar?.(r, false);
      const marcadas = await pool.query(
        `SELECT count(*)::int AS n FROM cartera.pagos_credito WHERE credito_id=$1 AND boleta_tardia_intento_id IS NOT NULL`,
        [esc.control],
      );
      expect(marcadas.rows[0].n).toBe(0);
    }, 60_000);
  }
});
