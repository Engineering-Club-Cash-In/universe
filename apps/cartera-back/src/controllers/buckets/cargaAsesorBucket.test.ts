import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Tests del controller REAL getCargaPorAsesorBucket con la DB (frontera del
 * sistema) fakeada — mismo espíritu que reasignarAsesor.test.ts: un fakeDb que
 * despacha db.execute() por una firma reconocible en el SQL (bucket_actual,
 * FROM buckets, FROM asesor_bucket) ya que las 3 queries del controller son
 * crudas (sql`...`), no drizzle builder.
 *
 * NOTA: capacidad_base (ticket CB-018, confirmado con el informador: "la
 * cantidad que puede atender un asesor") es un techo POR ASESOR dentro de un
 * bucket — vive en `asesor_bucket` (1 fila por asesor+bucket), NO en el
 * catálogo `buckets`. `sobrecarga` = cuentas > capacidad_base (sin margen).
 * `alerta_nueva_posicion` = cuentas > capacidad_base + margen (margen % o
 * fijo, también por fila, confirmado con el informador: "límite 100, alerta
 * a los 110" = capacidad + 10%). El resumen de bucket es solo informativo:
 * cuentas totales + conteos de asesores en alerta/sobrecarga.
 */

type Fila = Record<string, any>;

const estado = {
  cuentas: [] as Fila[],
  catalogo: [] as Fila[],
  pool: [] as Fila[],
};

function firmaDe(query: any): "cuentas" | "catalogo" | "pool" {
  const texto = (query?.queryChunks ?? [])
    .map((c: any) => (typeof c === "string" ? c : JSON.stringify(c)))
    .join(" ");
  if (texto.includes("bucket_actual")) return "cuentas";
  if (texto.includes("asesor_bucket")) return "pool";
  return "catalogo";
}

const fakeDb: any = {
  execute: async (query: any) => {
    const firma = firmaDe(query);
    if (firma === "cuentas") return { rows: estado.cuentas };
    if (firma === "pool") return { rows: estado.pool };
    return { rows: estado.catalogo };
  },
};

mock.module("../../database", () => ({ db: fakeDb }));

const { getCargaPorAsesorBucket, resolverMargen } = await import("./cargaAsesorBucket");

// Helper: fila de pool con margen porcentaje 10% (default) salvo que se
// sobreescriba explícitamente.
function poolRow(over: Partial<Fila> & { asesor_id: number; bucket: number; capacidad_base: number }) {
  return {
    margen_alerta_tipo: "porcentaje",
    margen_alerta_valor: 10,
    ...over,
  };
}

function reset() {
  estado.cuentas = [];
  estado.catalogo = [
    { numero: 0, prefijo: "B0", nombre: "Cartera Sana", color: "#22c55e" },
    { numero: 1, prefijo: "B1", nombre: "Alerta Temprana", color: "#eab308" },
  ];
  estado.pool = [];
}

describe("resolverMargen (pura)", () => {
  it("porcentaje: margen = capacidad * (valor/100)", () => {
    expect(resolverMargen(100, "porcentaje", 10)).toBe(10);
    expect(resolverMargen(300, "porcentaje", 10)).toBe(30);
  });

  it("fijo: margen = valor directo, independiente de la capacidad", () => {
    expect(resolverMargen(100, "fijo", 15)).toBe(15);
    expect(resolverMargen(300, "fijo", 15)).toBe(15);
  });
});

describe("getCargaPorAsesorBucket", () => {
  beforeEach(reset);

  it("calcula % utilización y sobrecarga por asesor+bucket usando la capacidad_base de ESA fila del pool", async () => {
    estado.cuentas = [
      { asesor_id: 1, nombre: "Ana", email_asesor: "ana@x.com", bucket: 0, cuentas: 150 },
    ];
    estado.pool = [poolRow({ asesor_id: 1, bucket: 0, capacidad_base: 300 })];

    const r = await getCargaPorAsesorBucket();

    expect(r.porAsesor).toHaveLength(1);
    const detalle = r.porAsesor[0].porBucket[0];
    expect(detalle.bucket).toBe(0);
    expect(detalle.cuentas).toBe(150);
    expect(detalle.capacidad_base).toBe(300);
    expect(detalle.utilizacion_pct).toBe(50);
    expect(detalle.elegible).toBe(true);
    expect(detalle.sobrecarga).toBe(false);
    expect(detalle.alerta_nueva_posicion).toBe(false);
  });

  it("margen PORCENTAJE (default 10%): alerta arranca EN 110 inclusive (capacidad=100), no antes", async () => {
    estado.pool = [poolRow({ asesor_id: 1, bucket: 0, capacidad_base: 100 })];

    estado.cuentas = [{ asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 105 }];
    let r = await getCargaPorAsesorBucket();
    let d = r.porAsesor[0].porBucket[0];
    expect(d.sobrecarga).toBe(true); // ya pasó capacidad_base (100)
    expect(d.alerta_nueva_posicion).toBe(false); // 105 aún no llega a 110
    expect(d.umbral_alerta_cuentas).toBe(110);

    // Caso límite EXACTO (review Codex): 110 = umbral exacto, debe SÍ disparar
    // (el ticket/migración 0005 documentan "alerta a partir de 110" —
    // inclusive, no estrictamente mayor).
    estado.cuentas = [{ asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 110 }];
    r = await getCargaPorAsesorBucket();
    d = r.porAsesor[0].porBucket[0];
    expect(d.alerta_nueva_posicion).toBe(true);

    estado.cuentas = [{ asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 111 }];
    r = await getCargaPorAsesorBucket();
    d = r.porAsesor[0].porBucket[0];
    expect(d.alerta_nueva_posicion).toBe(true);
  });

  it("margen FIJO: capacidad=100, margen fijo=15 → alerta arranca EN 115 inclusive, no en 110", async () => {
    estado.pool = [
      poolRow({
        asesor_id: 1,
        bucket: 0,
        capacidad_base: 100,
        margen_alerta_tipo: "fijo",
        margen_alerta_valor: 15,
      }),
    ];

    estado.cuentas = [{ asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 112 }];
    let r = await getCargaPorAsesorBucket();
    let d = r.porAsesor[0].porBucket[0];
    expect(d.umbral_alerta_cuentas).toBe(115);
    expect(d.alerta_nueva_posicion).toBe(false); // 112 aún no llega a 115

    // Caso límite EXACTO (review Codex): 115 = umbral exacto, debe SÍ disparar.
    estado.cuentas = [{ asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 115 }];
    r = await getCargaPorAsesorBucket();
    d = r.porAsesor[0].porBucket[0];
    expect(d.alerta_nueva_posicion).toBe(true);

    estado.cuentas = [{ asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 116 }];
    r = await getCargaPorAsesorBucket();
    d = r.porAsesor[0].porBucket[0];
    expect(d.alerta_nueva_posicion).toBe(true);
  });

  it("2 asesores en el mismo bucket con DISTINTA capacidad_base: sobrecarga y alerta se evalúan independiente para cada uno", async () => {
    estado.cuentas = [
      { asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 331 },
      { asesor_id: 2, nombre: "Bruno", email_asesor: null, bucket: 0, cuentas: 260 },
    ];
    estado.pool = [
      poolRow({ asesor_id: 1, bucket: 0, capacidad_base: 300 }), // umbral alerta = 330 → 331 sí alerta
      poolRow({ asesor_id: 2, bucket: 0, capacidad_base: 250 }), // 260 > 250 → sobrecarga; umbral alerta 275 → no alerta
    ];

    const r = await getCargaPorAsesorBucket();
    const ana = r.porAsesor.find((a) => a.asesor_id === 1)!.porBucket[0];
    const bruno = r.porAsesor.find((a) => a.asesor_id === 2)!.porBucket[0];

    expect(ana.capacidad_base).toBe(300);
    expect(ana.sobrecarga).toBe(true);
    expect(ana.alerta_nueva_posicion).toBe(true);

    expect(bruno.capacidad_base).toBe(250);
    expect(bruno.sobrecarga).toBe(true);
    expect(bruno.alerta_nueva_posicion).toBe(false);
  });

  it("asesor sobrecargado (pasó capacidad) pero SIN alerta (no pasó capacidad+margen) — bucket total cómodo", async () => {
    estado.cuentas = [
      { asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 105 },
      { asesor_id: 2, nombre: "Bruno", email_asesor: null, bucket: 0, cuentas: 10 },
    ];
    estado.pool = [
      poolRow({ asesor_id: 1, bucket: 0, capacidad_base: 100 }), // 105 > 100 sobrecarga, pero < 110 umbral alerta
      poolRow({ asesor_id: 2, bucket: 0, capacidad_base: 300 }),
    ];

    const r = await getCargaPorAsesorBucket();
    const ana = r.porAsesor.find((a) => a.asesor_id === 1)!.porBucket[0];
    const bruno = r.porAsesor.find((a) => a.asesor_id === 2)!.porBucket[0];

    expect(ana.sobrecarga).toBe(true);
    expect(ana.alerta_nueva_posicion).toBe(false);
    expect(bruno.sobrecarga).toBe(false);

    const b0 = r.buckets.find((b) => b.numero === 0)!;
    expect(b0.cuentas_totales).toBe(115);
    expect(b0.asesores_sobrecargados).toBe(1);
    expect(b0.asesores_en_alerta).toBe(0);
  });

  it("asesor con cuentas en un bucket donde NO está en el pool → elegible=false, capacidad y margen default", async () => {
    estado.cuentas = [
      { asesor_id: 2, nombre: "Bruno", email_asesor: null, bucket: 1, cuentas: 5 },
    ];
    estado.pool = []; // Bruno no está en ningún pool.

    const r = await getCargaPorAsesorBucket();
    const detalle = r.porAsesor[0].porBucket[0];
    expect(detalle.elegible).toBe(false);
    expect(detalle.capacidad_base).toBe(300);
    expect(detalle.umbral_alerta_cuentas).toBe(330); // 300 + 10% default
  });

  it("bucket con 0 cuentas sigue apareciendo en el resumen (capacidad ociosa)", async () => {
    estado.cuentas = [];
    estado.pool = [poolRow({ asesor_id: 1, bucket: 0, capacidad_base: 300 })];

    const r = await getCargaPorAsesorBucket();
    const b0 = r.buckets.find((b) => b.numero === 0)!;
    expect(b0.cuentas_totales).toBe(0);
    expect(b0.asesores_en_pool).toBe(1);
    expect(b0.asesores_en_alerta).toBe(0);
    expect(b0.asesores_sobrecargados).toBe(0);
  });

  it("filtro por bucket limita el resumen de buckets", async () => {
    estado.cuentas = [
      { asesor_id: 1, nombre: "Ana", email_asesor: null, bucket: 0, cuentas: 10 },
    ];
    const r = await getCargaPorAsesorBucket({ bucket: 0 });
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0].numero).toBe(0);
  });
});
