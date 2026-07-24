import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Tests del controller REAL actualizarCapacidadAsesorBucket con la DB
 * fakeada — mismo patrón que reasignarAsesor.test.ts: fakeDb que despacha
 * selects/updates por identidad de tabla drizzle.
 */

type Fila = Record<string, any>;

const estado = {
  selectsPorTabla: new Map<any, Fila[]>(),
  updates: [] as { tabla: any; set: Fila }[],
};

function crearBuilderSelect() {
  let tabla: any = null;
  const b: any = {
    from(t: any) {
      tabla = t;
      return b;
    },
    where() {
      return Promise.resolve(estado.selectsPorTabla.get(tabla) ?? []);
    },
  };
  return b;
}

const fakeDb: any = {
  select: () => crearBuilderSelect(),
  update(tabla: any) {
    return {
      set(s: Fila) {
        estado.updates.push({ tabla, set: s });
        return { where: () => Promise.resolve([]) };
      },
    };
  },
};

mock.module("../../database", () => ({ db: fakeDb, client: {} }));

const schema = await import("../../database/db/schema");
const { actualizarCapacidadAsesorBucket } = await import("./actualizarAsesorBucket");

beforeEach(() => {
  estado.selectsPorTabla.clear();
  estado.updates = [];
});

describe("actualizarCapacidadAsesorBucket — controller real con DB fakeada", () => {
  it("actualiza capacidad_base/margen de una fila existente del pool", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 250,
      margen_alerta_tipo: "fijo",
      margen_alerta_valor: 15,
    });

    expect(r).toEqual({ success: true, asesor_id: 7, bucket: 2 });
    expect(estado.updates).toHaveLength(1);
    expect(estado.updates[0].tabla).toBe(schema.asesor_bucket);
    expect(estado.updates[0].set).toMatchObject({
      capacidad_base: 250,
      margen_alerta_tipo: "fijo",
      margen_alerta_valor: "15",
    });
  });

  it("404 cuando el asesor no está en el pool de ese bucket", async () => {
    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 99,
      bucket: 3,
      capacidad_base: 300,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: 10,
    });

    expect(r).toMatchObject({ success: false, status: 404 });
    expect((r as any).message).toContain("no está en el pool activo");
    expect(estado.updates).toHaveLength(0);
  });

  it("404 cuando la fila existe pero está inactiva (activo=false) — no se actualiza (review Codex)", async () => {
    // El SELECT real filtra activo=true; una fila inactiva no aparece en el
    // resultado — mismo efecto que "no existe" desde la perspectiva del pool.
    estado.selectsPorTabla.set(schema.asesor_bucket, []);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 300,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: 10,
    });

    expect(r).toMatchObject({ success: false, status: 404 });
    expect(estado.updates).toHaveLength(0);
  });

  it("rechaza capacidad_base <= 0 sin tocar la DB (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 0,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: 10,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("capacidad_base");
    expect(estado.updates).toHaveLength(0);
  });

  it("rechaza capacidad_base no entero sin tocar la DB (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 250.5,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: 10,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("capacidad_base");
    expect(estado.updates).toHaveLength(0);
  });

  it("rechaza margen_alerta_valor negativo sin tocar la DB (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 300,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: -5,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("margen_alerta_valor");
    expect(estado.updates).toHaveLength(0);
  });

  it("rechaza capacidad_base > 2000 sin tocar la DB (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 2001,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: 10,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("capacidad_base");
    expect(estado.updates).toHaveLength(0);
  });

  it("rechaza margen_alerta_valor > 100 cuando el tipo es porcentaje (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 300,
      margen_alerta_tipo: "porcentaje",
      margen_alerta_valor: 150,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("margen_alerta_valor");
    expect(estado.updates).toHaveLength(0);
  });

  it("permite margen_alerta_valor > 100 cuando el tipo es fijo (no aplica el tope de %)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 300,
      margen_alerta_tipo: "fijo",
      margen_alerta_valor: 150,
    });

    expect(r).toMatchObject({ success: true });
    expect(estado.updates).toHaveLength(1);
  });

  it("rechaza margen_alerta_valor > 500 cuando el tipo es fijo (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 300,
      margen_alerta_tipo: "fijo",
      margen_alerta_valor: 501,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("margen_alerta_valor");
    expect(estado.updates).toHaveLength(0);
  });

  it("rechaza margen_alerta_tipo inválido sin tocar la DB (400)", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [{ id: 1 }]);

    const r = await actualizarCapacidadAsesorBucket({
      asesor_id: 7,
      bucket: 2,
      capacidad_base: 300,
      margen_alerta_tipo: "otro" as any,
      margen_alerta_valor: 10,
    });

    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("margen_alerta_tipo");
    expect(estado.updates).toHaveLength(0);
  });
});
