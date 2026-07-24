import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Tests de CB-023 (apertura matutina). Dos capas:
 *
 *  1. Funciones PURAS (calcularMontoAdeudado / rankearTop3 / resumirCumplimiento)
 *     — sin DB, sin mock. Son la especificación legible de la fórmula del
 *     ranking y del cumplimiento; el SQL las replica en set-based.
 *
 *  2. getAperturaDia con la DB fakeada por FIRMA del SQL (mismo espíritu que
 *     cargaAsesorBucket.test.ts): las 3 queries del controller son crudas
 *     (sql`...`), así que un fakeDb despacha db.execute() según qué texto
 *     reconoce en la query (buckets_historial → cuentas nuevas, ROW_NUMBER →
 *     top3, cuotas_ayer → cumplimiento).
 */

type Fila = Record<string, any>;

const estado = {
  cuentasNuevas: [] as Fila[],
  top3: [] as Fila[],
  cumplimiento: [] as Fila[],
  asignacion: [] as Fila[],
  movimientos: [] as Fila[],
};

function firmaDe(
  query: any,
): "cuentasNuevas" | "top3" | "cumplimiento" | "asignacion" | "movimientos" {
  const texto = (query?.queryChunks ?? [])
    .map((c: any) => (typeof c === "string" ? c : JSON.stringify(c)))
    .join(" ");
  if (texto.includes("cuotas_ayer")) return "cumplimiento";
  if (texto.includes("ROW_NUMBER")) return "top3";
  // Las 3 restantes leen buckets_historial; las distinguen sus JOINs propios.
  if (texto.includes("LATERAL")) return "movimientos";
  if (texto.includes("c.asesor_id")) return "asignacion";
  return "cuentasNuevas";
}

const fakeDb: any = {
  execute: async (query: any) => {
    const firma = firmaDe(query);
    return { rows: estado[firma] };
  },
};

mock.module("../../database", () => ({ db: fakeDb }));

const {
  calcularMontoAdeudado,
  rankearTop3,
  resumirCumplimiento,
  getAperturaDia,
} = await import("./aperturaDia");

// ─────────────────────────── Funciones puras ───────────────────────────────

describe("calcularMontoAdeudado (pura)", () => {
  it("(cuotas vencidas × cuota) + recargo de mora", () => {
    // 3 vencidas × Q10,000 + Q1,200 recargo = Q31,200.
    expect(calcularMontoAdeudado(3, 10000, 1200)).toBe(31200);
  });

  it("cero vencidas → solo el recargo", () => {
    expect(calcularMontoAdeudado(0, 10000, 1200)).toBe(1200);
  });

  it("mora null/NaN → COALESCE a 0", () => {
    expect(calcularMontoAdeudado(2, 5000, Number.NaN)).toBe(10000);
  });

  it("cuotas negativas se tratan como 0 (no restan)", () => {
    expect(calcularMontoAdeudado(-4, 5000, 300)).toBe(300);
  });
});

describe("rankearTop3 (pura)", () => {
  it("ordena por monto adeudado desc y corta a 3", () => {
    const filas = [
      { credito_id: 1, monto_adeudado: 100, cuotas_vencidas: 1 },
      { credito_id: 2, monto_adeudado: 900, cuotas_vencidas: 3 },
      { credito_id: 3, monto_adeudado: 500, cuotas_vencidas: 2 },
      { credito_id: 4, monto_adeudado: 700, cuotas_vencidas: 2 },
    ];
    const r = rankearTop3(filas);
    expect(r.map((x) => x.credito_id)).toEqual([2, 4, 3]);
  });

  it("la de 8 cuotas × Q3,000 (Q25,900) va ANTES que la de 3 × Q7,500 (Q23,100)", () => {
    // El caso exacto discutido: gana el acumulado, no el monto de cuota suelto.
    const grande = { credito_id: 10, monto_adeudado: 44800, cuotas_vencidas: 3 };
    const acumulada = { credito_id: 20, monto_adeudado: 25900, cuotas_vencidas: 8 };
    const chica = { credito_id: 30, monto_adeudado: 23100, cuotas_vencidas: 3 };
    const r = rankearTop3([chica, grande, acumulada]);
    expect(r.map((x) => x.credito_id)).toEqual([10, 20, 30]);
  });

  it("desempate determinístico: mismo monto → más cuotas vencidas, luego credito_id asc", () => {
    const filas = [
      { credito_id: 5, monto_adeudado: 1000, cuotas_vencidas: 2 },
      { credito_id: 3, monto_adeudado: 1000, cuotas_vencidas: 4 },
      { credito_id: 9, monto_adeudado: 1000, cuotas_vencidas: 2 },
    ];
    const r = rankearTop3(filas);
    expect(r.map((x) => x.credito_id)).toEqual([3, 5, 9]);
  });
});

describe("resumirCumplimiento (pura)", () => {
  it("pct = pagadas / esperadas × 100", () => {
    const r = resumirCumplimiento({
      fecha: "2026-07-21",
      cuentas_esperadas: 60,
      cuentas_pagadas: 45,
      monto_esperado: 250000,
      monto_pagado: 187500,
    });
    expect(r.pct).toBe(75);
    expect(r.cuentas_pagadas).toBe(45);
  });

  it("cero esperadas → pct 0, nunca NaN (no divide por cero)", () => {
    const r = resumirCumplimiento({
      fecha: "2026-07-21",
      cuentas_esperadas: 0,
      cuentas_pagadas: 0,
      monto_esperado: 0,
      monto_pagado: 0,
    });
    expect(r.pct).toBe(0);
    expect(Number.isNaN(r.pct)).toBe(false);
  });
});

// ─────────────────────────── Controller (DB fakeada) ───────────────────────

function reset() {
  estado.cuentasNuevas = [];
  estado.top3 = [];
  estado.asignacion = [];
  estado.movimientos = [];
  estado.cumplimiento = [
    {
      fecha_ayer: "2026-07-21",
      cuentas_esperadas: 0,
      cuentas_pagadas: 0,
      monto_esperado: "0",
      monto_pagado: "0",
    },
  ];
}

describe("getAperturaDia", () => {
  beforeEach(reset);

  it("arma las 3 secciones desde las 3 queries", async () => {
    estado.cuentasNuevas = [
      { bucket: 1, desde: 0, tipo_evento: "SUBIDA", cantidad: 4 },
      { bucket: 1, desde: 2, tipo_evento: "BAJADA", cantidad: 1 },
    ];
    estado.top3 = [
      {
        credito_id: 10, numero_credito_sifco: "C-10", cliente: "Juan", bucket: 2,
        status_credito: "MOROSO", cuotas_vencidas: 3, monto_cuota: "10000.00",
        monto_mora: "1200.00", monto_adeudado: "31200.00", dias_mora: 92,
        asesor_id: 7, asesor: "Ana", total_criticos: 5, rn: 1,
      },
    ];
    estado.cumplimiento = [
      { fecha_ayer: "2026-07-21", cuentas_esperadas: 60, cuentas_pagadas: 45, monto_esperado: "250000", monto_pagado: "187500" },
    ];

    const r = await getAperturaDia({ fecha: "2026-07-22" });

    expect(r.fecha).toBe("2026-07-22");
    expect(r.cuentas_nuevas[0]).toMatchObject({ bucket: 1, subidas: 4, bajadas: 1, entradas: 5 });
    expect(r.cumplimiento.pct).toBe(75);
    expect(r.top3[0].bucket).toBe(2);
    expect(r.top3[0].peor_monto).toBe(31200);
    expect(r.top3[0].total_criticos).toBe(5);
    expect(r.top3[0].top[0].monto_adeudado).toBe(31200);
  });

  it("bucket sin críticos → no aparece en top3 (el front rellena las 6 secciones)", async () => {
    estado.top3 = []; // ningún crédito crítico
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.top3).toEqual([]);
  });

  it("agrupa varias filas del mismo bucket y toma el peor monto", async () => {
    estado.top3 = [
      { credito_id: 1, numero_credito_sifco: "A", cliente: "x", bucket: 3, status_credito: "MOROSO", cuotas_vencidas: 8, monto_cuota: "3000", monto_mora: "1900", monto_adeudado: "25900", dias_mora: 241, asesor_id: null, asesor: null, total_criticos: 2, rn: 1 },
      { credito_id: 2, numero_credito_sifco: "B", cliente: "y", bucket: 3, status_credito: "MOROSO", cuotas_vencidas: 3, monto_cuota: "7500", monto_mora: "600", monto_adeudado: "23100", dias_mora: 88, asesor_id: null, asesor: null, total_criticos: 2, rn: 2 },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.top3).toHaveLength(1);
    expect(r.top3[0].top).toHaveLength(2);
    expect(r.top3[0].peor_monto).toBe(25900);
  });
});

describe("asignación del día: ingresos al bucket del asesor", () => {
  beforeEach(reset);

  it("suma los ingresos del asesor sin distinguir subida de bajada", async () => {
    // Samuel atiende B2: le entró 1 desde B1 (venía subiendo) y 1 desde B3
    // (venía bajando). Para él son 2 cuentas nuevas, punto.
    estado.asignacion = [
      { asesor_id: 6, asesor: "Samuel", desde: 1, bucket: 2, cantidad: 1, buckets_pool: [2] },
      { asesor_id: 6, asesor: "Samuel", desde: 3, bucket: 2, cantidad: 1, buckets_pool: [2] },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });

    expect(r.asignacion).toHaveLength(1);
    expect(r.asignacion[0].ingresos).toBe(2);
    expect(r.asignacion[0].porBucket.map((b) => b.desde)).toEqual([1, 3]);
  });

  it("conserva el bucket de ORIGEN de cada ingreso", async () => {
    estado.asignacion = [
      { asesor_id: 3, asesor: "Erik", desde: 3, bucket: 4, cantidad: 2, buckets_pool: [4] },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion[0].porBucket).toEqual([
      { desde: 3, bucket: 4, cantidad: 2 },
    ]);
  });

  it("ordena por cantidad de ingresos desc", async () => {
    estado.asignacion = [
      { asesor_id: 9, asesor: "Ana", desde: 0, bucket: 1, cantidad: 1, buckets_pool: [1] },
      { asesor_id: 7, asesor: "Diego", desde: 0, bucket: 1, cantidad: 5, buckets_pool: [1] },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion.map((a) => a.asesor)).toEqual(["Diego", "Ana"]);
  });

  it("a igual cantidad, el asesor del bucket más alto va primero", async () => {
    estado.asignacion = [
      { asesor_id: 4, asesor: "Caren", desde: 1, bucket: 0, cantidad: 2, buckets_pool: [0] },
      { asesor_id: 3, asesor: "Erik", desde: 3, bucket: 4, cantidad: 2, buckets_pool: [4] },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion.map((a) => a.asesor)).toEqual(["Erik", "Caren"]);
  });

  it("expone el pool del asesor (buckets_pool)", async () => {
    estado.asignacion = [
      { asesor_id: 7, asesor: "Diego", desde: 0, bucket: 1, cantidad: 2, buckets_pool: [1] },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion[0].buckets_pool).toEqual([1]);
  });

  it("asesor sin fila en el pool → buckets_pool vacío, no revienta", async () => {
    estado.asignacion = [
      { asesor_id: 7, asesor: "Diego", desde: 0, bucket: 1, cantidad: 1, buckets_pool: null },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion[0].buckets_pool).toEqual([]);
  });

  it("agrupa los créditos sin asesor bajo asesor_id null (no los pierde)", async () => {
    estado.asignacion = [
      { asesor_id: null, asesor: null, desde: 2, bucket: 3, cantidad: 2 },
      { asesor_id: null, asesor: null, desde: 4, bucket: 3, cantidad: 1 },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion).toHaveLength(1);
    expect(r.asignacion[0]).toMatchObject({ asesor_id: null, ingresos: 3 });
  });

  it("día sin transiciones → asignación vacía", async () => {
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion).toEqual([]);
  });

  // El filtro "solo entradas al bucket del asesor" vive en el WHERE del SQL
  // (EXISTS contra asesor_bucket), así que el fakeDb ya recibe filas filtradas.
  // Lo que se verifica aquí es la consecuencia visible: un asesor al que no le
  // entró nada simplemente no viene en el resultado.
  it("un asesor sin entradas a su bucket no aparece en la lista", async () => {
    // Gerencia atiende B5 y hoy solo tuvo movimiento en B1/B2 → el SQL no la
    // devuelve. Solo llega Erik, con lo que entró a su B4.
    estado.asignacion = [
      { asesor_id: 3, asesor: "Erik", desde: 3, bucket: 4, cantidad: 2, buckets_pool: [4] },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.asignacion).toHaveLength(1);
    expect(r.asignacion[0].asesor).toBe("Erik");
    expect(r.asignacion[0].porBucket[0].bucket).toBe(4);
  });
});

describe("cuentas nuevas: desglose por bucket de origen", () => {
  beforeEach(reset);

  it("pliega varios orígenes en un bucket destino y suma subidas/bajadas", async () => {
    // B1 recibe: 2 que SUBIERON desde B0, 3 que BAJARON desde B2, 1 desde B3.
    estado.cuentasNuevas = [
      { bucket: 1, desde: 0, tipo_evento: "SUBIDA", cantidad: 2 },
      { bucket: 1, desde: 2, tipo_evento: "BAJADA", cantidad: 3 },
      { bucket: 1, desde: 3, tipo_evento: "BAJADA", cantidad: 1 },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });

    expect(r.cuentas_nuevas).toHaveLength(1);
    const b1 = r.cuentas_nuevas[0];
    expect(b1).toMatchObject({ bucket: 1, subidas: 2, bajadas: 4, entradas: 6 });
    expect(b1.origenes).toEqual([
      { desde: 0, tipo: "SUBIDA", cantidad: 2 },
      { desde: 2, tipo: "BAJADA", cantidad: 3 },
      { desde: 3, tipo: "BAJADA", cantidad: 1 },
    ]);
  });

  it("ordena los buckets destino por número", async () => {
    estado.cuentasNuevas = [
      { bucket: 3, desde: 2, tipo_evento: "SUBIDA", cantidad: 1 },
      { bucket: 0, desde: 1, tipo_evento: "BAJADA", cantidad: 2 },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.cuentas_nuevas.map((c) => c.bucket)).toEqual([0, 3]);
  });
});

describe("movimientos del día (detalle por crédito)", () => {
  beforeEach(reset);

  it("calcula los saltos de bucket del movimiento", async () => {
    estado.movimientos = [
      {
        credito_id: 10, numero_credito_sifco: "C-10", cliente: "Juan",
        bucket_anterior: 1, bucket_nuevo: 3, tipo_evento: "SUBIDA",
        status_credito: "MOROSO", cuotas_vencidas: 3, monto_cuota: "10000",
        monto_mora: "1200", monto_adeudado: "31200", dias_mora: 92,
        asesor_id: 7, asesor: "Diego", fecha: "2026-07-22T02:00:00",
      },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.movimientos[0]).toMatchObject({
      credito_id: 10,
      saltos: 2, // B1 → B3
      monto_adeudado: 31200,
      tipo_evento: "SUBIDA",
    });
  });

  it("una bajada también cuenta saltos (valor absoluto, nunca negativo)", async () => {
    estado.movimientos = [
      {
        credito_id: 11, numero_credito_sifco: "C-11", cliente: "Ana",
        bucket_anterior: 3, bucket_nuevo: 1, tipo_evento: "BAJADA",
        status_credito: "MOROSO", cuotas_vencidas: 1, monto_cuota: "5000",
        monto_mora: "0", monto_adeudado: "5000", dias_mora: 10,
        asesor_id: null, asesor: null, fecha: "2026-07-22T02:00:00",
      },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.movimientos[0].saltos).toBe(2);
  });

  it("día sin movimientos → lista vacía", async () => {
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.movimientos).toEqual([]);
  });
});

// ─────────────────────── Frontera de día en timezone GT ────────────────────
//
// El código marca esta conversión como fuente recurrente de bugs, y con razón:
// ya falló una vez en producción de pruebas. `buckets_historial.fecha` es un
// timestamp SIN timezone guardado con now() (UTC). Convertirlo a día GT exige
// DOS etapas — marcar el naive como UTC y después pasar a Guatemala. Con una
// sola conversión Postgres interpreta el naive COMO hora GT y suma 6h en vez
// de restarlas, así que todo evento después de las 18:00 GT se contaba en el
// día siguiente (justo la franja del job de moras nocturno).
//
// Estos tests inspeccionan el SQL emitido: la regresión sería silenciosa (no
// tira error, solo devuelve filas de menos), así que se verifica la FORMA de
// la expresión, no el resultado.
describe("conversión de día GT (regresión: AT TIME ZONE invertido)", () => {
  // Los chunks de drizzle anidan: strings sueltos, StringChunk {value: []} y
  // fragmentos sql`` con sus propios queryChunks. Se recorre en profundidad.
  const sqlDe = (query: any): string => {
    const partes: string[] = [];
    const walk = (n: any, d = 0) => {
      if (n == null || d > 8) return;
      if (typeof n === "string") return void partes.push(n);
      if (Array.isArray(n)) return void n.forEach((x) => walk(x, d + 1));
      if (typeof n === "object") {
        if (typeof n.value === "string") partes.push(n.value);
        else if (Array.isArray(n.value)) walk(n.value, d + 1);
        if (n.queryChunks) walk(n.queryChunks, d + 1);
      }
    };
    walk(query?.queryChunks);
    return partes.join(" ");
  };

  it("toda query que filtre por día usa las DOS etapas UTC → America/Guatemala", async () => {
    reset();
    const capturadas: string[] = [];
    const original = fakeDb.execute;
    fakeDb.execute = async (query: any) => {
      capturadas.push(sqlDe(query));
      return original(query);
    };
    await getAperturaDia({ fecha: "2026-07-22" });
    fakeDb.execute = original;

    // Conteo EXACTO, no un mínimo: son 3 las queries que filtran transiciones
    // por día — cuentas nuevas, movimientos y asignación. (El top3 NO entra:
    // usa la fecha contra cuotas_credito, no contra buckets_historial.) Un
    // `>=` dejaría pasar que una de las 3 pierda la conversión, justo la
    // regresión que estos tests existen para atrapar.
    // `diaGTDe` parte la expresión en chunks (el nombre de columna viaja en un
    // sql.raw aparte), así que se normalizan los espacios antes de buscar.
    const norm = (s: string) => s.replace(/\s+/g, " ");
    const conFecha = capturadas
      .map(norm)
      .filter((s) => s.includes("h.fecha AT TIME ZONE"));
    expect(conFecha).toHaveLength(3);
    for (const s of conFecha) {
      // El orden importa: 'UTC' SIEMPRE antes que 'America/Guatemala'.
      const idxUtc = s.indexOf("AT TIME ZONE 'UTC'");
      const idxGt = s.indexOf("AT TIME ZONE 'America/Guatemala'");
      if (idxGt !== -1 && s.includes("h.fecha")) {
        expect(idxUtc).toBeGreaterThan(-1);
        expect(idxUtc).toBeLessThan(idxGt);
      }
    }
  });

  it("ninguna query convierte h.fecha directo a GT (la forma que causó el bug)", async () => {
    reset();
    const capturadas: string[] = [];
    const original = fakeDb.execute;
    fakeDb.execute = async (query: any) => {
      capturadas.push(sqlDe(query));
      return original(query);
    };
    await getAperturaDia({ fecha: "2026-07-22" });
    fakeDb.execute = original;

    for (const s of capturadas) {
      expect(s).not.toContain("h.fecha AT TIME ZONE 'America/Guatemala'");
    }
  });
});

// ─────────────────────────── Errores de la DB ──────────────────────────────
describe("errores de la base de datos", () => {
  it("un fallo de cualquier sección propaga el error (no devuelve data a medias)", async () => {
    reset();
    const original = fakeDb.execute;
    fakeDb.execute = async () => {
      throw new Error("connection terminated unexpectedly");
    };
    // Promise.all: si una query cae, la vista completa falla. Es lo correcto —
    // una apertura con secciones vacías en silencio haría que el supervisor
    // creyera que no hubo movimiento. El router lo traduce a 500.
    await expect(getAperturaDia({ fecha: "2026-07-22" })).rejects.toThrow(
      "connection terminated unexpectedly",
    );
    fakeDb.execute = original;
  });

  it("filas con columnas nulas no revientan el mapeo", async () => {
    reset();
    // Un LEFT JOIN sin match deja nulls; el mapeo debe absorberlos.
    estado.movimientos = [
      {
        credito_id: 10, numero_credito_sifco: null, cliente: null,
        bucket_anterior: null, bucket_nuevo: 2, tipo_evento: "SUBIDA",
        status_credito: null, cuotas_vencidas: null, monto_cuota: "0",
        monto_mora: "0", monto_adeudado: "0", dias_mora: 0,
        asesor_id: null, asesor: null, fecha: "2026-07-22T02:00:00",
      },
    ];
    const r = await getAperturaDia({ fecha: "2026-07-22" });
    expect(r.movimientos[0]).toMatchObject({
      credito_id: 10,
      cuotas_vencidas: 0, // null → 0, no NaN
      saltos: 0, // sin bucket_anterior no hay salto que medir
      asesor: null,
    });
  });
});
