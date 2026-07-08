import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * E2E del MOTOR DE BUCKETS (COBROS-02) a través de su seam público:
 * `procesarMoras()` — el job completo, con la DB (frontera del sistema)
 * fakeada. Cada test reproduce un escenario del ciclo validado A MANO en el
 * sandbox `cartera_cobros2` el 2026-07-08 con el crédito 8818 (B2, 2 cuotas,
 * asesor Samuel/6): registrar pago → validar → job → BAJADA + reasignación.
 *
 * Lo observable (el contrato): el resumen que devuelve el job y las filas
 * que escribe por tabla (moras_credito, buckets_historial,
 * credito_asesor_historial, creditos). No se asserta NADA interno.
 */

// ── Fake de la frontera DB ──────────────────────────────────────────────────
// Despacha selects por IDENTIDAD de tabla drizzle y graba inserts/updates.
type Fila = Record<string, any>;

const estado = {
  selects: new Map<any, Fila[]>(),
  ultimos: [] as { credito_id: number; bucket_nuevo: number }[],
  inserts: [] as { tabla: any; filas: Fila[] }[],
  updates: [] as { tabla: any; set: Fila }[],
};

function crearBuilderSelect() {
  let tabla: any = null;
  const b: any = {
    from(t: any) { tabla = t; return b; },
    innerJoin() { return b; },
    leftJoin() { return b; },
    where() { return b; },
    orderBy() { return b; },
    limit() { return b; },
    offset() { return b; },
    then(res: any, rej: any) {
      return Promise.resolve(estado.selects.get(tabla) ?? []).then(res, rej);
    },
  };
  return b;
}

function crearMutadores() {
  return {
    insert(tabla: any) {
      return {
        values(v: Fila | Fila[]) {
          const filas = Array.isArray(v) ? v : [v];
          estado.inserts.push({ tabla, filas });
          // returning() del CREACION de mora espera mora_id + porcentaje.
          const conId = filas.map((f, i) => ({ mora_id: 90000 + i, porcentaje_mora: "1.12", ...f }));
          const p: any = Promise.resolve(conId);
          p.returning = () => Promise.resolve(conId);
          p.onConflictDoNothing = () => Promise.resolve(conId);
          return p;
        },
      };
    },
    update(tabla: any) {
      return {
        set(s: Fila) {
          estado.updates.push({ tabla, set: s });
          return { where: () => Promise.resolve([]) };
        },
      };
    },
  };
}

const fakeDb: any = {
  select: () => crearBuilderSelect(),
  ...crearMutadores(),
  transaction: async (cb: any) => cb(crearMutadores()),
};

const fakeClient: any = {
  connect: async () => ({
    query: async (q: string) => {
      if (q.includes("pg_try_advisory_lock")) return { rows: [{ ok: true }] };
      if (q.includes("pg_advisory_unlock")) return { rows: [] };
      // el DISTINCT ON del último bucket por crédito
      return { rows: estado.ultimos };
    },
    release() {},
  }),
};

mock.module("../database", () => ({ db: fakeDb, client: fakeClient }));

const { procesarMoras, isOverdueInstallmentForMora, elegirAsesorParaBucket } = await import("./latefee");
const {
  creditos,
  cuotas_credito,
  moras_credito,
  buckets,
  asesor_bucket,
  buckets_historial,
  credito_asesor_historial,
  pagos_credito,
} = await import("../database/db/schema");

// ── Helpers de escenario ────────────────────────────────────────────────────

const dias = (n: number) => new Date(Date.now() + n * 86_400_000);

/** Catálogo B0-B5 VÁLIDO (pasa validarCatalogoBuckets): mismo seed real. */
const CATALOGO_VALIDO = [
  { numero: 0, prefijo: "B0", nombre: "Cartera Sana", descripcion: null, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [], es_operativo: true, orden: 0, color: null, estado_mora: "al_dia" },
  { numero: 1, prefijo: "B1", nombre: "Alerta Temprana", descripcion: null, cuotas_min: 1, cuotas_max: 1, estados_incluidos: [], es_operativo: true, orden: 1, color: null, estado_mora: "mora_30" },
  { numero: 2, prefijo: "B2", nombre: "Gestión Activa", descripcion: null, cuotas_min: 2, cuotas_max: 2, estados_incluidos: [], es_operativo: true, orden: 2, color: null, estado_mora: "mora_60" },
  { numero: 3, prefijo: "B3", nombre: "Rescate", descripcion: null, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [], es_operativo: true, orden: 3, color: null, estado_mora: "mora_90" },
  { numero: 4, prefijo: "B4", nombre: "Última Instancia / Pre Jurídico", descripcion: null, cuotas_min: 4, cuotas_max: 4, estados_incluidos: [], es_operativo: true, orden: 4, color: null, estado_mora: "mora_120" },
  { numero: 5, prefijo: "B5", nombre: "Jurídico", descripcion: null, cuotas_min: 5, cuotas_max: null, estados_incluidos: ["INCOBRABLE"], es_operativo: false, orden: 5, color: null, estado_mora: "mora_120_plus" },
];

/** Pool real de la prueba: 1 asesor por bucket, salvo B1 con dos (3=Diego, 8=Prueba). */
const POOL = [
  { asesor_id: 4, bucket: 0 },
  { asesor_id: 3, bucket: 1 },
  { asesor_id: 8, bucket: 1 },
  { asesor_id: 6, bucket: 2 },
  { asesor_id: 5, bucket: 3 },
  { asesor_id: 1, bucket: 4 },
  { asesor_id: 2, bucket: 5 },
];

/** Crédito espejo del 8818: MOROSO, asesor 6 (B2), cuotas #2 y #3 vencidas. */
function cuotasDelCredito8818(opts: { cuota2Validada: boolean }) {
  const base = { credito_id: 8818, statusCredit: "MOROSO", capital: "259378.59", asesor_id: 6, pagado: false };
  return [
    { ...base, cuota_id: 115658, fecha_vencimiento: dias(-40), hasPaidPayment: opts.cuota2Validada },
    { ...base, cuota_id: 115659, fecha_vencimiento: dias(-10), hasPaidPayment: false },
    { ...base, cuota_id: 115660, fecha_vencimiento: dias(+20), hasPaidPayment: false },
  ];
}

/** Dos créditos B1 de Diego (3) para que la carga de B1 quede 3:2 vs 8:0. */
const CARGA_B1_DE_DIEGO = {
  cuotas: [901, 902].map((id) => ({
    cuota_id: id * 10, credito_id: id, fecha_vencimiento: dias(-10), pagado: false,
    statusCredit: "MOROSO", capital: "100000", asesor_id: 3, hasPaidPayment: false,
  })),
  moras: [901, 902].map((id) => ({
    mora_id: id, credito_id: id, monto_mora: "1120.00", cuotas_atrasadas: 1, porcentaje_mora: "1.12",
  })),
  ultimos: [901, 902].map((id) => ({ credito_id: id, bucket_nuevo: 1 })),
};

function prepararEscenario(opts: {
  cuotas: Fila[];
  morasActivas?: Fila[];
  catalogo?: Fila[];
  pool?: Fila[];
  ultimos?: { credito_id: number; bucket_nuevo: number }[];
  pagos?: Fila[];
}) {
  estado.selects = new Map<any, Fila[]>([
    [cuotas_credito, opts.cuotas],
    [moras_credito, opts.morasActivas ?? []],
    [buckets, opts.catalogo ?? CATALOGO_VALIDO],
    [asesor_bucket, opts.pool ?? POOL],
    [pagos_credito, opts.pagos ?? [{ pago_id: 116167 }]],
  ]);
  estado.ultimos = opts.ultimos ?? [];
  estado.inserts = [];
  estado.updates = [];
}

const insertsEn = (tabla: any) =>
  estado.inserts.filter((i) => i.tabla === tabla).flatMap((i) => i.filas);
const updatesEn = (tabla: any) =>
  estado.updates.filter((u) => u.tabla === tabla).map((u) => u.set);

beforeEach(() => prepararEscenario({ cuotas: [] }));

// ── El ciclo probado a mano en el sandbox, ahora como especificación ───────

describe("motor de buckets — ciclo pago → validación → job (E2E con DB fakeada)", () => {
  it("pago registrado SIN validar: el job re-crea la mora pero NO mueve bucket ni asesor", async () => {
    // La mora fue absorbida al registrar el pago (moras_credito quedó vacía),
    // pero la cuota #2 aún no tiene pago validado → sigue contando 2.
    prepararEscenario({
      cuotas: cuotasDelCredito8818({ cuota2Validada: false }),
      morasActivas: [],
      ultimos: [{ credito_id: 8818, bucket_nuevo: 2 }],
    });

    const r = await procesarMoras();

    // La mora renace con 2 cuotas (el quirk viejo, ahora especificado)…
    const morasCreadas = insertsEn(moras_credito);
    expect(morasCreadas).toHaveLength(1);
    expect(morasCreadas[0]).toMatchObject({ credito_id: 8818, cuotas_atrasadas: 2 });
    // …y el motor NO registra transiciones ni toca al asesor.
    expect(insertsEn(buckets_historial)).toHaveLength(0);
    expect(insertsEn(credito_asesor_historial)).toHaveLength(0);
    expect(updatesEn(creditos).filter((s) => "asesor_id" in s)).toHaveLength(0);
    expect(r.buckets).toMatchObject({ subidas: 0, bajadas: 0, reasignados: 0 });
  });

  it("pago VALIDADO + job: BAJADA B2→B1 con pago trazado y reasignación al asesor con menor carga de B1", async () => {
    prepararEscenario({
      cuotas: [...cuotasDelCredito8818({ cuota2Validada: true }), ...CARGA_B1_DE_DIEGO.cuotas],
      morasActivas: [
        { mora_id: 93892, credito_id: 8818, monto_mora: "5810.08", cuotas_atrasadas: 2, porcentaje_mora: "1.12" },
        ...CARGA_B1_DE_DIEGO.moras,
      ],
      ultimos: [{ credito_id: 8818, bucket_nuevo: 2 }, ...CARGA_B1_DE_DIEGO.ultimos],
      pagos: [{ pago_id: 116167 }],
    });

    const r = await procesarMoras();

    // Transición registrada: B2→B1, 1 cuota, con el pago que curó la cuenta.
    const transiciones = insertsEn(buckets_historial);
    expect(transiciones).toHaveLength(1);
    expect(transiciones[0]).toMatchObject({
      credito_id: 8818,
      tipo_evento: "BAJADA",
      bucket_anterior: 2,
      bucket_nuevo: 1,
      cuotas_atrasadas_nuevas: 1,
      pago_id: 116167,
      origen: "PROCESO_AUTO",
    });
    // Reasignación equitativa: B1 tiene a Diego(3, carga 2) y Prueba(8, carga 0)
    // → gana el 8. Bitácora obligatoria + UPDATE únicamente de asesor_id.
    const bitacora = insertsEn(credito_asesor_historial);
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toMatchObject({
      credito_id: 8818,
      asesor_anterior: 6,
      asesor_nuevo: 8,
      bucket: 1,
      origen: "PROCESO_AUTO",
    });
    const cambiosAsesor = updatesEn(creditos).filter((s) => "asesor_id" in s);
    expect(cambiosAsesor).toHaveLength(1);
    expect(cambiosAsesor[0]).toEqual({ asesor_id: 8 }); // SOLO ese campo (decisión de raíz)
    expect(r.buckets).toMatchObject({ bajadas: 1, reasignados: 1, sinPoolDestino: 0 });
  });

  it("primera vez que el motor ve un crédito: siembra INICIAL (línea base) sin reasignar", async () => {
    prepararEscenario({
      cuotas: cuotasDelCredito8818({ cuota2Validada: false }),
      ultimos: [], // el motor nunca lo ha visto
    });

    const r = await procesarMoras();

    const iniciales = insertsEn(buckets_historial);
    expect(iniciales).toHaveLength(1);
    expect(iniciales[0]).toMatchObject({
      credito_id: 8818,
      tipo_evento: "INICIAL",
      bucket_anterior: null,
      bucket_nuevo: 2,
    });
    expect(insertsEn(credito_asesor_historial)).toHaveLength(0);
    expect(r.buckets).toMatchObject({ iniciales: 1, reasignados: 0 });
  });

  it("INCOBRABLE entra a B5 por estados_incluidos aunque su mora esté apagada (0 cuotas) y pasa al asesor de B5", async () => {
    prepararEscenario({
      cuotas: [{
        cuota_id: 7001, credito_id: 700, fecha_vencimiento: dias(-40), pagado: false,
        statusCredit: "INCOBRABLE", capital: "50000", asesor_id: 9, hasPaidPayment: false,
      }],
      morasActivas: [],
      ultimos: [{ credito_id: 700, bucket_nuevo: 4 }],
    });

    const r = await procesarMoras();

    const transiciones = insertsEn(buckets_historial);
    expect(transiciones).toHaveLength(1);
    expect(transiciones[0]).toMatchObject({
      credito_id: 700,
      tipo_evento: "SUBIDA",
      bucket_anterior: 4,
      bucket_nuevo: 5,
      cuotas_atrasadas_nuevas: 0, // INCOBRABLE no lleva mora — entra por estado
    });
    const bitacora = insertsEn(credito_asesor_historial);
    expect(bitacora[0]).toMatchObject({ asesor_anterior: 9, asesor_nuevo: 2, bucket: 5 });
    expect(r.buckets).toMatchObject({ subidas: 1, reasignados: 1 });
  });

  it("bucket destino sin asesores en el pool: registra la transición pero el crédito conserva su asesor", async () => {
    prepararEscenario({
      cuotas: cuotasDelCredito8818({ cuota2Validada: true }),
      morasActivas: [{ mora_id: 93892, credito_id: 8818, monto_mora: "5810.08", cuotas_atrasadas: 2, porcentaje_mora: "1.12" }],
      ultimos: [{ credito_id: 8818, bucket_nuevo: 2 }],
      pool: POOL.filter((p) => p.bucket !== 1), // B1 sin elegibles
    });

    const r = await procesarMoras();

    expect(insertsEn(buckets_historial)).toHaveLength(1); // la BAJADA sí queda
    expect(insertsEn(credito_asesor_historial)).toHaveLength(0);
    expect(updatesEn(creditos).filter((s) => "asesor_id" in s)).toHaveLength(0);
    expect(r.buckets).toMatchObject({ bajadas: 1, reasignados: 0, sinPoolDestino: 1 });
  });

  it("el asesor actual ya es elegible en el bucket destino: se queda (sin churn, sin bitácora)", async () => {
    // El crédito baja B2→B1 pero su asesor actual es Diego (3), que ES del pool de B1.
    const cuotas = cuotasDelCredito8818({ cuota2Validada: true }).map((c) => ({ ...c, asesor_id: 3 }));
    prepararEscenario({
      cuotas,
      morasActivas: [{ mora_id: 93892, credito_id: 8818, monto_mora: "5810.08", cuotas_atrasadas: 2, porcentaje_mora: "1.12" }],
      ultimos: [{ credito_id: 8818, bucket_nuevo: 2 }],
    });

    const r = await procesarMoras();

    expect(insertsEn(buckets_historial)).toHaveLength(1);
    expect(insertsEn(credito_asesor_historial)).toHaveLength(0);
    expect(updatesEn(creditos).filter((s) => "asesor_id" in s)).toHaveLength(0);
    expect(r.buckets).toMatchObject({ bajadas: 1, reasignados: 0, sinPoolDestino: 0 });
  });

  it("catálogo inconsistente (gap de cobertura): omite el pass completo y lo reporta, sin persistir transiciones", async () => {
    prepararEscenario({
      cuotas: cuotasDelCredito8818({ cuota2Validada: true }),
      morasActivas: [{ mora_id: 93892, credito_id: 8818, monto_mora: "5810.08", cuotas_atrasadas: 2, porcentaje_mora: "1.12" }],
      ultimos: [{ credito_id: 8818, bucket_nuevo: 2 }],
      catalogo: CATALOGO_VALIDO.filter((b) => b.numero !== 2), // hueco en 2..2
    });

    const r = await procesarMoras();

    expect(insertsEn(buckets_historial)).toHaveLength(0);
    expect(insertsEn(credito_asesor_historial)).toHaveLength(0);
    expect(r.buckets).toMatchObject({ omitidoPorFallback: true, bajadas: 0, reasignados: 0 });
  });
});

describe("isOverdueInstallmentForMora", () => {
  it("no cuenta como vencida una cuota con pago asociado ya pagado", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: true,
        statusCredit: "MOROSO",
      },
      new Date("2026-05-26T06:00:00.000Z"),
    );

    expect(result).toBe(false);
  });

  it("cuenta como vencida una cuota pasada sin cuota pagada ni pago asociado pagado", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: false,
        statusCredit: "ACTIVO",
      },
      new Date("2026-05-26T06:00:00.000Z"),
    );

    expect(result).toBe(true);
  });

  it("no cuenta cuotas futuras como vencidas", () => {
    const result = isOverdueInstallmentForMora(
      {
        fecha_vencimiento: new Date("2026-06-15T06:00:00.000Z"),
        pagado: false,
        hasPaidPayment: false,
        statusCredit: "ACTIVO",
      },
      new Date("2026-05-26T06:00:00.000Z"),
    );

    expect(result).toBe(false);
  });
});

// FASE 3 (COBROS-02) — reparto de asesor al entrar a un bucket
describe("elegirAsesorParaBucket", () => {
  it("pool vacío → null (el crédito conserva su asesor)", () => {
    expect(elegirAsesorParaBucket([], new Map(), 7)).toBeNull();
  });

  it("bucket con 1 solo asesor → asignación directa", () => {
    expect(elegirAsesorParaBucket([4], new Map(), 7)).toBe(4);
  });

  it("el asesor actual ya es elegible en el destino → se queda (sin churn)", () => {
    const carga = new Map([
      [3, 50],
      [9, 0],
    ]);
    // aunque el 9 tenga menos carga, el 3 ya lleva el crédito y es elegible
    expect(elegirAsesorParaBucket([3, 9], carga, 3)).toBe(3);
  });

  it("N asesores → gana el de MENOR carga (equitativo)", () => {
    const carga = new Map([
      [3, 10],
      [9, 4],
    ]);
    expect(elegirAsesorParaBucket([3, 9], carga, 7)).toBe(9);
  });

  it("empate de carga → gana el menor asesor_id (determinístico)", () => {
    const carga = new Map([
      [9, 5],
      [3, 5],
    ]);
    expect(elegirAsesorParaBucket([9, 3], carga, 7)).toBe(3);
  });

  it("sin mapa de carga → todos cuentan 0 y gana el menor asesor_id", () => {
    expect(elegirAsesorParaBucket([9, 3], undefined, null)).toBe(3);
  });

  it("asesor sin entrada en el mapa de carga cuenta como 0", () => {
    const carga = new Map([[3, 2]]); // el 9 no aparece → carga 0
    expect(elegirAsesorParaBucket([3, 9], carga, null)).toBe(9);
  });
});
