import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Archivo separado de `latefee.test.ts` a propósito: aquel prueba el cálculo de
 * mora con sus propios fakes, este el MOTOR DE BUCKETS con los suyos. Comparten
 * el módulo bajo prueba (`latefee.ts`) pero no la infraestructura de test, y
 * fusionarlos en un archivo obligaba a elegir un solo doble de la DB.
 *
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

let transactionCalls = 0;
let transactionExecutorOverride: any = null;

const fakeDb: any = {
  select: () => crearBuilderSelect(),
  ...crearMutadores(),
  transaction: async (cb: any) => {
    transactionCalls++;
    return cb(transactionExecutorOverride ?? crearMutadores());
  },
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

const {
  procesarMoras,
  isOverdueInstallmentForMora,
  elegirAsesorParaBucket,
  updateMora,
  updateMoraEnTx,
} = await import("./latefee");
// CB-030 — misma función que usa el freeze real (latefee la importa de acá,
// no la reimplementa): si divergen, estos tests lo detectan.
const { hoyGtISO } = await import("../lib/buckets-classification");
const {
  creditos,
  cuotas_credito,
  moras_credito,
  buckets,
  asesor_bucket,
  buckets_historial,
  credito_asesor_historial,
  pagos_credito,
  moras_historial,
  platform_users,
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

beforeEach(() => {
  prepararEscenario({ cuotas: [] });
  transactionCalls = 0;
  transactionExecutorOverride = null;
});

function crearTxUpdateMora() {
  const inserts: { tabla: any; filas: Fila[] }[] = [];
  const updates: { tabla: any; set: Fila }[] = [];
  const savepoints = { calls: 0 };
  const selects = new Map<any, Fila[][]>([
    [creditos, [
      [{ credito_id: 8818 }],
      [{ statusCredit: "ACTIVO" }],
    ]],
    [platform_users, [[{ id: 44 }]]],
    [moras_credito, [[{
      id: 93892,
      monto: "100.00",
      activa: true,
      porcentaje_mora: "1.12",
      cuotas_atrasadas: 2,
    }]]],
  ]);

  const tx: any = {
    transaction(callback: (savepoint: any) => Promise<unknown>) {
      savepoints.calls++;
      return callback(tx);
    },
    select() {
      let tabla: any;
      const builder: any = {
        from(value: any) { tabla = value; return builder; },
        where() { return builder; },
        orderBy() { return builder; },
        limit() { return builder; },
        for() { return builder; },
        then(resolve: any, reject: any) {
          const queue = selects.get(tabla) ?? [];
          return Promise.resolve(queue.shift() ?? []).then(resolve, reject);
        },
      };
      return builder;
    },
    update(tabla: any) {
      return {
        set(value: Fila) {
          updates.push({ tabla, set: value });
          const rows = tabla === moras_credito
            ? [{ mora_id: 93892, porcentaje_mora: "1.12", ...value }]
            : [];
          const result: any = {
            where() {
              const promise: any = Promise.resolve(rows);
              promise.returning = () => Promise.resolve(rows);
              return promise;
            },
          };
          return result;
        },
      };
    },
    insert(tabla: any) {
      return {
        values(value: Fila | Fila[]) {
          inserts.push({ tabla, filas: Array.isArray(value) ? value : [value] });
          return Promise.resolve([]);
        },
      };
    },
  };

  return { tx, inserts, updates, savepoints };
}

describe("updateMoraEnTx", () => {
  it("usa solo el executor inyectado e inserta el historial en la misma transacción", async () => {
    const fake = crearTxUpdateMora();

    const result = await updateMoraEnTx({
      numero_credito_sifco: "01010214103710",
      monto_cambio: 25,
      tipo: "INCREMENTO",
      cuotas_atrasadas: 3,
      usuario_email: "pagalo@clubcashin.com",
    }, fake.tx);

    expect(result).toMatchObject({
      success: true,
      newStatus: "MOROSO",
      mora: { mora_id: 93892, monto_mora: "125" },
    });
    expect(transactionCalls).toBe(0);
    expect(fake.inserts.filter((entry) => entry.tabla === moras_historial)).toHaveLength(1);
    expect(fake.updates.map((entry) => entry.tabla)).toEqual([moras_credito, creditos]);
  });

  it("propaga errores inesperados para que la transacción exterior haga rollback", async () => {
    const expected = new Error("db unavailable");
    const tx: any = {
      select: () => ({
        from: () => ({
          where: () => Promise.reject(expected),
        }),
      }),
    };

    expect(updateMoraEnTx({
      numero_credito_sifco: "01010214103710",
      monto_cambio: 25,
      tipo: "INCREMENTO",
    }, tx)).rejects.toBe(expected);
  });

  it("por defecto propaga un fallo de historial para abortar la transacción exterior", async () => {
    const expected = new Error("history insert failed");
    const fake = crearTxUpdateMora();
    fake.tx.insert = () => ({
      values: () => Promise.reject(expected),
    });

    expect(updateMoraEnTx({
      credito_id: 8818,
      monto_cambio: 25,
      tipo: "INCREMENTO",
    }, fake.tx)).rejects.toBe(expected);
  });
});

describe("updateMora", () => {
  it("abre exactamente una transacción y delega la operación completa", async () => {
    const fake = crearTxUpdateMora();
    transactionExecutorOverride = fake.tx;

    const result = await updateMora({
      credito_id: 8818,
      monto_cambio: 25,
      tipo: "INCREMENTO",
    });

    expect(result.success).toBe(true);
    expect(transactionCalls).toBe(1);
    expect(fake.inserts.filter((entry) => entry.tabla === moras_historial)).toHaveLength(1);
  });

  it("conserva historial best-effort para callers legados", async () => {
    const fake = crearTxUpdateMora();
    let outerTransactionAborted = false;
    fake.tx.insert = () => ({
      values: () => {
        outerTransactionAborted = true;
        return Promise.reject(new Error("same-level history insert failed"));
      },
    });
    fake.tx.transaction = async (callback: (savepoint: any) => Promise<unknown>) => {
      fake.savepoints.calls++;
      const savepoint = Object.create(fake.tx);
      savepoint.insert = () => ({
        values: () => Promise.reject(new Error("savepoint history insert failed")),
      });
      return callback(savepoint);
    };
    transactionExecutorOverride = fake.tx;

    const result = await updateMora({
      credito_id: 8818,
      monto_cambio: 25,
      tipo: "INCREMENTO",
    });

    expect(result.success).toBe(true);
    expect(transactionCalls).toBe(1);
    expect(fake.savepoints.calls).toBe(1);
    expect(outerTransactionAborted).toBe(false);
    expect(fake.updates.map((entry) => entry.tabla)).toEqual([moras_credito, creditos]);
  });

  // Antes esta prueba verificaba que el mismo `requestId` saliera en el log de
  // inicio y en el de error. develop reemplazó esos banners por
  // emitCreditLateFee, cuyo payload no lleva request id, así que esa
  // correlación ya no es observable — y `requestId` quedó sin lector (ya venía
  // así en develop, no lo introdujo el merge). Se conserva la mitad que sí es
  // comportamiento: que el fallo dentro de la transacción salga como un
  // resultado de error y no como una excepción.
  it("con SIFCO, un fallo dentro de la transacción vuelve como resultado de error", async () => {
    const expected = new Error("mora select failed");
    transactionExecutorOverride = {
      select() {
        let tabla: any;
        const builder: any = {
          from(value: any) { tabla = value; return builder; },
          where() { return builder; },
          orderBy() { return builder; },
          limit() { return builder; },
          for() { return builder; },
          then(resolve: any, reject: any) {
            const result = tabla === creditos
              ? Promise.resolve([{ credito_id: 8818 }])
              : Promise.reject(expected);
            return result.then(resolve, reject);
          },
        };
        return builder;
      },
    };

    const result = await updateMora({
      numero_credito_sifco: "01010214103710",
      monto_cambio: 25,
      tipo: "INCREMENTO",
    });

    expect(result).toMatchObject({ success: false, error: String(expected) });
  });
});

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

// CB-030 — freeze por cuota cuando hay promesa de pago vigente
describe("isOverdueInstallmentForMora — freeze por promesa (CB-030)", () => {
  const hoy = new Date("2026-05-26T06:00:00.000Z");
  const cuotaBase = {
    fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"), // vencida
    pagado: false,
    hasPaidPayment: false,
    statusCredit: "MOROSO",
  };

  it("sin Map de promesas (parámetro omitido) → comportamiento idéntico al actual", () => {
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5 },
      hoy,
    );
    expect(result).toBe(true);
  });

  it("promesa vigente cubre esta cuota → NO cuenta como vencida (congelada)", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: 4, cuota_fin: 6, fecha_promesa: "2026-05-30" }]],
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(false);
  });

  it("promesa vigente cubre OTRA cuota → esta SÍ cuenta como vencida", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: 4, cuota_fin: 6, fecha_promesa: "2026-05-30" }]],
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 8, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(true);
  });

  it("promesa VENCIDA (fecha_promesa < hoy) sin pago → deja de congelar, cuenta como vencida", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: 4, cuota_fin: 6, fecha_promesa: "2026-05-20" }]],
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(true);
  });

  it("cuota exactamente en cuota_inicio → congelada (bound inclusivo)", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: 5, cuota_fin: 6, fecha_promesa: "2026-05-30" }]],
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(false);
  });

  it("cuota exactamente en cuota_fin → congelada (bound inclusivo)", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: 4, cuota_fin: 5, fecha_promesa: "2026-05-30" }]],
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(false);
  });

  it("fecha_promesa === hoy exacto → sigue vigente, congela (Codex PR #1234: toZonedTime corría la fecha date-only un día para atrás)", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: 4, cuota_fin: 6, fecha_promesa: "2026-05-26" }]], // === hoy
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(false);
  });

  it("promesa sin rango (cuota_inicio/cuota_fin null) → NO congela ninguna cuota", () => {
    const promesas = new Map([
      [1, [{ cuota_inicio: null, cuota_fin: null, fecha_promesa: "2026-05-30" }]],
    ]);
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(true);
  });

  it("Map de promesas vacío para este crédito → comportamiento normal", () => {
    const promesas = new Map<number, any[]>();
    const result = isOverdueInstallmentForMora(
      { ...cuotaBase, numero_cuota: 5, credito_id: 1 },
      hoy,
      promesas,
      1,
    );
    expect(result).toBe(true);
  });

  it('"salto directo": 2 cuotas venciendo durante la ventana de promesa, luego la promesa vence sin pago → ambas cuentan de una vez', () => {
    // Simula la corrida DESPUÉS de que la promesa (fecha_promesa=2026-05-20)
    // ya venció sin pago: el Map de promesas vigentes viene VACÍO para este
    // crédito (la promesa dejó de ser vigente, ya no se pasa/ya no aplica).
    // cuotasVencidas debe reflejar TODAS las cuotas realmente vencidas —
    // nunca hubo acumulación incremental que "recuperar": el conteo siempre
    // se calcula desde fechas reales.
    const cuota5 = {
      ...cuotaBase,
      numero_cuota: 5,
      fecha_vencimiento: new Date("2026-05-16T06:00:00.000Z"),
      credito_id: 1,
    };
    const cuota6 = {
      ...cuotaBase,
      numero_cuota: 6,
      fecha_vencimiento: new Date("2026-05-18T06:00:00.000Z"),
      credito_id: 1,
    };
    const promesasVencidasSinEfecto = new Map<number, any[]>(); // ya no vigente
    const cuotas = [cuota5, cuota6].filter((c) =>
      isOverdueInstallmentForMora(c, hoy, promesasVencidasSinEfecto, 1),
    );
    expect(cuotas.length).toBe(2); // salto directo: ambas cuentan, no incremental
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

// CB-030 — el día calendario GT no puede depender del TZ del proceso.
// `hoyGtISO` usaba toZonedTime(...).setHours(0,0,0,0) + toISOString(): setHours
// opera en la zona del PROCESO y toISOString lee en UTC, así que con TZ del host
// al este de UTC (Europe/Madrid, Asia/Tokyo) devolvía el día anterior a toda
// hora. Y `fecha_vencimiento` (columna `date`) pasaba por toZonedTime, que le
// resta 6h y la corre un día atrás cuando el driver la entrega como Date.
// Efecto: promesa leída como vencida un día antes, freeze liberado temprano y
// bucket subido de más (Codex review PR #1235).
describe("día calendario GT — independiente del TZ del proceso (CB-030)", () => {
  const diaGtRef = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  it("hoyGtISO coincide con el día GT real en cada hora de 48h", () => {
    const desalineadas: string[] = [];
    for (let h = 0; h < 48; h++) {
      const ahora = new Date(Date.UTC(2026, 7, 4, h, 30));
      if (hoyGtISO(ahora) !== diaGtRef(ahora)) desalineadas.push(ahora.toISOString());
    }
    expect(desalineadas).toEqual([]);
  });

  it("hoyGtISO cruza de día exactamente a medianoche GT (06:00 UTC)", () => {
    expect(hoyGtISO(new Date("2026-08-04T05:59:59.000Z"))).toBe("2026-08-03");
    expect(hoyGtISO(new Date("2026-08-04T06:00:00.000Z"))).toBe("2026-08-04");
  });

  it("fecha_vencimiento date-only: string y Date dan el MISMO veredicto que el SQL (venc < hoy_gt)", () => {
    const discrepancias: string[] = [];
    for (let h = 0; h < 48; h++) {
      const hoy = new Date(Date.UTC(2026, 7, 4, h, 30));
      const diaGt = diaGtRef(hoy);
      for (const venc of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
        const esperado = venc < diaGt; // semántica de `cu.fecha_vencimiento::date < hoy_gt`
        const comoString = isOverdueInstallmentForMora(
          { fecha_vencimiento: venc, pagado: false, statusCredit: "MOROSO" },
          hoy,
        );
        const comoDate = isOverdueInstallmentForMora(
          { fecha_vencimiento: new Date(`${venc}T00:00:00.000Z`), pagado: false, statusCredit: "MOROSO" },
          hoy,
        );
        if (comoString !== esperado || comoDate !== esperado) {
          discrepancias.push(`${hoy.toISOString()} venc=${venc} str=${comoString} date=${comoDate} esperado=${esperado}`);
        }
      }
    }
    expect(discrepancias).toEqual([]);
  });

  it("cuota que vence HOY en GT no está vencida (bound inclusivo, igual que el SQL)", () => {
    const hoy = new Date("2026-08-04T20:00:00.000Z"); // 14:00 en GT
    expect(
      isOverdueInstallmentForMora(
        { fecha_vencimiento: "2026-08-04", pagado: false, statusCredit: "MOROSO" },
        hoy,
      ),
    ).toBe(false);
    expect(
      isOverdueInstallmentForMora(
        { fecha_vencimiento: "2026-08-03", pagado: false, statusCredit: "MOROSO" },
        hoy,
      ),
    ).toBe(true);
  });

  it("promesa que vence HOY en GT sigue congelando (>= hoy), tanto string como Date", () => {
    const hoy = new Date("2026-08-04T20:00:00.000Z");
    const cuota = { numero_cuota: 3, fecha_vencimiento: "2026-07-01", pagado: false, statusCredit: "MOROSO" };
    for (const fecha_promesa of ["2026-08-04", new Date("2026-08-04T00:00:00.000Z")] as const) {
      const mapa = new Map([[77, [{ cuota_inicio: 1, cuota_fin: 5, fecha_promesa }]]]);
      expect(isOverdueInstallmentForMora(cuota, hoy, mapa, 77)).toBe(false);
    }
    // un día después ya no protege
    for (const fecha_promesa of ["2026-08-03", new Date("2026-08-03T00:00:00.000Z")] as const) {
      const mapa = new Map([[77, [{ cuota_inicio: 1, cuota_fin: 5, fecha_promesa }]]]);
      expect(isOverdueInstallmentForMora(cuota, hoy, mapa, 77)).toBe(true);
    }
  });
});
