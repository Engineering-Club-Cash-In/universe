import { describe, expect, it } from "bun:test";
import { validarCatalogoBuckets } from "./buckets-validation";
import { bucketDeCredito } from "./buckets-classification";
import type { BucketCatalogo, BucketCatalogoCompleto } from "./buckets-classification";

const SEED_VALIDO: BucketCatalogoCompleto[] = [
  { numero: 0, prefijo: "B0", nombre: "Cartera Sana", descripcion: null, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [], es_operativo: true, orden: 0, color: null, estado_mora: "al_dia", dias_sla: null },
  { numero: 1, prefijo: "B1", nombre: "Alerta Temprana", descripcion: null, cuotas_min: 1, cuotas_max: 1, estados_incluidos: [], es_operativo: true, orden: 1, color: null, estado_mora: "mora_30", dias_sla: 3 },
  { numero: 2, prefijo: "B2", nombre: "Gestión Activa", descripcion: null, cuotas_min: 2, cuotas_max: 2, estados_incluidos: [], es_operativo: true, orden: 2, color: null, estado_mora: "mora_60", dias_sla: 3 },
  { numero: 3, prefijo: "B3", nombre: "Rescate", descripcion: null, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [], es_operativo: true, orden: 3, color: null, estado_mora: "mora_90", dias_sla: 2 },
  { numero: 4, prefijo: "B4", nombre: "Última Instancia / Pre Jurídico", descripcion: null, cuotas_min: 4, cuotas_max: 4, estados_incluidos: [], es_operativo: true, orden: 4, color: null, estado_mora: "mora_120", dias_sla: 2 },
  { numero: 5, prefijo: "B5", nombre: "Jurídico", descripcion: null, cuotas_min: 5, cuotas_max: null, estados_incluidos: ["INCOBRABLE"], es_operativo: false, orden: 5, color: null, estado_mora: "mora_120_plus", dias_sla: 1 },
];

describe("validarCatalogoBuckets", () => {
  it("catálogo seed (B0-B5) es válido", () => {
    const { ok, problemas } = validarCatalogoBuckets(SEED_VALIDO);
    expect(ok).toBe(true);
    expect(problemas).toEqual([]);
  });

  it("detecta overlap entre filas consecutivas", () => {
    const catalogo = SEED_VALIDO.map((b) =>
      b.numero === 2 ? { ...b, cuotas_min: 1, cuotas_max: 2 } : b,
    );
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("overlap"))).toBe(true);
  });

  it("detecta gap entre filas (bucket desactivado en medio)", () => {
    const catalogo = SEED_VALIDO.filter((b) => b.numero !== 2);
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("gap"))).toBe(true);
  });

  it("detecta orden duplicado entre buckets operativos", () => {
    const catalogo = SEED_VALIDO.map((b) => (b.numero === 1 ? { ...b, orden: 0 } : b));
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("orden duplicado"))).toBe(true);
  });

  it("detecta cobertura incompleta: primer bucket no empieza en 0", () => {
    const catalogo = SEED_VALIDO.map((b) => (b.numero === 0 ? { ...b, cuotas_min: 1 } : b));
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("no en 0"))).toBe(true);
  });

  it("detecta cobertura incompleta: último bucket del catálogo no es abierto", () => {
    const catalogo = SEED_VALIDO.map((b) => (b.numero === 5 ? { ...b, cuotas_max: 10 } : b));
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("debería ser abierto"))).toBe(true);
  });

  it("es_operativo=false no rompe cobertura si el rango sigue contiguo y abierto (B5 legal)", () => {
    const { ok, problemas } = validarCatalogoBuckets(SEED_VALIDO);
    expect(ok).toBe(true);
    expect(problemas).toEqual([]);
  });

  it("detecta numero duplicado en el catálogo", () => {
    const catalogo = [...SEED_VALIDO, { ...SEED_VALIDO[1], orden: 6 }];
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("numero duplicado"))).toBe(true);
  });

  it("catálogo sin ninguna fila operativa es inválido", () => {
    const catalogo = SEED_VALIDO.map((b) => ({ ...b, es_operativo: false }));
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(problemas.some((p) => p.includes("sin ninguna fila operativa"))).toBe(true);
  });

  it("orden y cuotas_min desalineados (admin reordena presentación sin tocar rangos) sigue válido", () => {
    // orden invertido respecto a cuotas_min: B0 pasa a orden=5, B5 a orden=0,
    // etc. Los RANGOS de cuotas siguen intactos y contiguos — el catálogo
    // sigue siendo válido. Si el walk de cobertura caminara por `orden` en
    // vez de por `cuotas_min`, compararía filas no-adyacentes por cuota
    // (ej. B0 cuotas_min=0 vs B1 cuotas_min=1, pero en posiciones de orden
    // opuestas) y produciría overlap/gap falsos.
    const catalogo = SEED_VALIDO.map((b) => ({ ...b, orden: 5 - b.orden }));
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(true);
    expect(problemas).toEqual([]);
  });

  it("detecta el mismo status incluido en más de un bucket", () => {
    // INCOBRABLE ya está en B5 (seed). Si además aparece en B3, bucketDeCredito
    // (find first-match por orden de array) resolvería siempre al primero que
    // aparezca en el catálogo — mis-clasificación silenciosa, y cambiar
    // `orden` (sin tocar estados_incluidos) cambiaría cuál bucket gana.
    const catalogo = SEED_VALIDO.map((b) =>
      b.numero === 3 ? { ...b, estados_incluidos: ["INCOBRABLE"] } : b,
    );
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(false);
    expect(
      problemas.some((p) => p.includes("INCOBRABLE") && p.includes("más de un bucket")),
    ).toBe(true);
  });

  it("status repetido DENTRO de la misma fila no cuenta como conflicto", () => {
    // ["INCOBRABLE", "INCOBRABLE"] en la MISMA fila (typo de siembra, no
    // ambigüedad real) — bucketDeCredito lo resuelve igual sin importar
    // cuántas veces aparezca el valor. Un catálogo válido no debe tumbarse
    // por esto.
    const catalogo = SEED_VALIDO.map((b) =>
      b.numero === 5 ? { ...b, estados_incluidos: ["INCOBRABLE", "INCOBRABLE"] } : b,
    );
    const { ok, problemas } = validarCatalogoBuckets(catalogo);
    expect(ok).toBe(true);
    expect(problemas).toEqual([]);
  });
});

describe("bucketDeCredito", () => {
  const catalogo: BucketCatalogo[] = SEED_VALIDO.map((b) => ({
    numero: b.numero,
    cuotas_min: b.cuotas_min,
    cuotas_max: b.cuotas_max,
    estados_incluidos: b.estados_incluidos,
  }));

  it("clasifica por rango de cuotas atrasadas", () => {
    expect(bucketDeCredito("AL_DIA", 0, catalogo)).toBe(0);
    expect(bucketDeCredito("MOROSO", 1, catalogo)).toBe(1);
    expect(bucketDeCredito("MOROSO", 3, catalogo)).toBe(3);
  });

  it("clasifica en el bucket abierto (cuotas_max null) cuando excede el último rango cerrado", () => {
    expect(bucketDeCredito("MOROSO", 5, catalogo)).toBe(5);
    expect(bucketDeCredito("MOROSO", 100, catalogo)).toBe(5);
  });

  it("respeta límites exactos entre buckets consecutivos", () => {
    expect(bucketDeCredito("MOROSO", 1, catalogo)).toBe(1);
    expect(bucketDeCredito("MOROSO", 2, catalogo)).toBe(2);
  });

  it("estado que fuerza bucket vía estados_incluidos gana sobre el rango de cuotas", () => {
    expect(bucketDeCredito("INCOBRABLE", 0, catalogo)).toBe(5);
  });

  it("status fuera del funnel operativo devuelve null", () => {
    expect(bucketDeCredito("EN_CONVENIO", 10, catalogo)).toBeNull();
    expect(bucketDeCredito("CANCELADO", 10, catalogo)).toBeNull();
  });

  it("gap en el catálogo (bucket faltante) devuelve null en vez de clasificar mal", () => {
    const catalogoConGap = catalogo.filter((b) => b.numero !== 2);
    expect(bucketDeCredito("MOROSO", 2, catalogoConGap)).toBeNull();
  });

  it("clasifica correcto aunque el array llegue en orden `orden` desalineado de cuotas_min", () => {
    // validarCatalogoBuckets valida cobertura por cuotas_min (no por orden) —
    // un catálogo con orden invertido pero rangos contiguos/sin overlap pasa
    // el guard. bucketDeCredito hace find() first-match sobre el array tal
    // como llega (orden SQL real: `.orderBy(buckets.orden)`). Si el catálogo
    // YA es válido (sin overlap), el orden del array no puede cambiar el
    // resultado — cada `cuotas` matchea como máximo un rango. Este test lo
    // confirma explícitamente contra el mismo catálogo desalineado que
    // valida OK en buckets-validation.test.ts.
    const catalogoOrdenInvertido: BucketCatalogo[] = SEED_VALIDO
      .map((b) => ({ ...b, orden: 5 - b.orden }))
      .sort((a, b) => a.orden - b.orden)
      .map((b) => ({
        numero: b.numero,
        cuotas_min: b.cuotas_min,
        cuotas_max: b.cuotas_max,
        estados_incluidos: b.estados_incluidos,
      }));

    expect(bucketDeCredito("MOROSO", 0, catalogoOrdenInvertido)).toBe(0);
    expect(bucketDeCredito("MOROSO", 3, catalogoOrdenInvertido)).toBe(3);
    expect(bucketDeCredito("MOROSO", 100, catalogoOrdenInvertido)).toBe(5);
  });
});
