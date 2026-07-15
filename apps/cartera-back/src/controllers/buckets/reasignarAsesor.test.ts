import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Tests del controller REAL reasignarAsesorManual/getAsesoresPorBucket con la
 * DB (frontera del sistema) fakeada — mismo patrón que latefee.test.ts (motor
 * automático de la misma carpeta): un fakeDb que despacha por identidad de
 * tabla drizzle y graba inserts/updates/transacciones. Nada de lógica
 * duplicada: se prueba el módulo tal cual corre en producción.
 */

type Fila = Record<string, any>;

const estado = {
  // Resultado configurable por test para cada select, por tabla drizzle.
  selectsPorTabla: new Map<any, Fila[]>(),
  // Resultado configurable para el db.execute() crudo (bucketActualDeCredito).
  executeResult: { rows: [] as Fila[] },
  inserts: [] as { tabla: any; filas: Fila[] }[],
  updates: [] as { tabla: any; set: Fila }[],
};

function crearBuilderSelect() {
  let tabla: any = null;
  const b: any = {
    from(t: any) {
      tabla = t;
      return b;
    },
    innerJoin() {
      return b;
    },
    leftJoin() {
      return b;
    },
    where() {
      return b;
    },
    orderBy() {
      return b;
    },
    limit() {
      return b;
    },
    then(res: any, rej: any) {
      return Promise.resolve(estado.selectsPorTabla.get(tabla) ?? []).then(res, rej);
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
          return Promise.resolve(filas);
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
  execute: async () => estado.executeResult,
  transaction: async (cb: any) => cb(crearMutadores()),
};

mock.module("../../database", () => ({ db: fakeDb }));

const schema = await import("../../database/db/schema");
const {
  getAsesoresPorBucket,
  reasignarAsesorManual,
} = await import("./reasignarAsesor");

// Helper: setea el resultado de bucketActualDeCredito (db.execute crudo).
function setBucketActual(bucket: number | null, fuera = false) {
  estado.executeResult = {
    rows: [{ bucket, fuera }],
  };
}

beforeEach(() => {
  estado.selectsPorTabla.clear();
  estado.executeResult = { rows: [] };
  estado.inserts = [];
  estado.updates = [];
});

describe("getAsesoresPorBucket", () => {
  it("devuelve el pool tal cual lo da la query", async () => {
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 2, nombre: "Samuel Gamboa" },
      { asesor_id: 7, nombre: "Erik Rivas" },
    ]);
    const pool = await getAsesoresPorBucket(2);
    expect(pool).toEqual([
      { asesor_id: 2, nombre: "Samuel Gamboa" },
      { asesor_id: 7, nombre: "Erik Rivas" },
    ]);
  });

  it("pool vacío cuando el bucket no tiene asesores", async () => {
    const pool = await getAsesoresPorBucket(3);
    expect(pool).toEqual([]);
  });
});

describe("reasignarAsesorManual — controller real con DB fakeada", () => {
  it("reasigna correctamente: bitácora + UPDATE en una transacción", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: 2 }]);
    setBucketActual(1);
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 2, nombre: "Samuel Gamboa" },
      { asesor_id: 7, nombre: "Erik Rivas" },
    ]);
    estado.selectsPorTabla.set(schema.platform_users, [{ id: 55 }]);

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 7,
      motivo: "Rotación por vacaciones",
      usuario_email: "supervisor@clubcashin.com",
    });

    expect(r).toEqual({
      success: true,
      credito_id: 9116,
      asesor_anterior: 2,
      asesor_nuevo: 7,
      bucket: 1,
    });

    // Bitácora: origen API_MANUAL, motivo, usuario_id resuelto, snapshot de bucket.
    expect(estado.inserts).toHaveLength(1);
    expect(estado.inserts[0].tabla).toBe(schema.credito_asesor_historial);
    expect(estado.inserts[0].filas[0]).toMatchObject({
      credito_id: 9116,
      asesor_anterior: 2,
      asesor_nuevo: 7,
      bucket: 1,
      origen: "API_MANUAL",
      motivo: "Rotación por vacaciones",
      usuario_id: 55,
    });

    // UPDATE: ÚNICAMENTE asesor_id (decisión de raíz, nada más del crédito).
    expect(estado.updates).toHaveLength(1);
    expect(estado.updates[0].tabla).toBe(schema.creditos);
    expect(estado.updates[0].set).toEqual({ asesor_id: 7 });
  });

  it("rechaza motivo vacío sin tocar la DB de escritura (400)", async () => {
    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 7,
      motivo: "   ",
    });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect(estado.inserts).toHaveLength(0);
    expect(estado.updates).toHaveLength(0);
  });

  it("404 cuando el crédito no existe", async () => {
    // selectsPorTabla sin entrada para creditos → [] → no encontrado.
    const r = await reasignarAsesorManual({
      credito_id: 424242,
      asesor_nuevo_id: 7,
      motivo: "motivo válido",
    });
    expect(r).toMatchObject({ success: false, status: 404 });
  });

  it("rechaza crédito fuera del funnel operativo (bucket null, 400)", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: 2 }]);
    setBucketActual(null, true);

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 7,
      motivo: "motivo válido",
    });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("fuera del funnel");
    expect(estado.inserts).toHaveLength(0);
  });

  it("rechaza asesor no elegible en el pool del bucket (400)", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: 2 }]);
    setBucketActual(1);
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 2, nombre: "Samuel Gamboa" },
    ]);

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 99,
      motivo: "motivo válido",
    });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("no es elegible");
    expect(estado.inserts).toHaveLength(0);
  });

  it("rechaza no-op: reasignar al mismo asesor actual (400)", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: 2 }]);
    setBucketActual(1);
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 2, nombre: "Samuel Gamboa" },
    ]);

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 2,
      motivo: "motivo válido",
    });
    expect(r).toMatchObject({ success: false, status: 400 });
    expect((r as any).message).toContain("ya está asignado");
    expect(estado.inserts).toHaveLength(0);
  });

  it("usuario_id queda null si el email no resuelve en platform_users (best-effort)", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: 2 }]);
    setBucketActual(1);
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 2, nombre: "Samuel Gamboa" },
      { asesor_id: 7, nombre: "Erik Rivas" },
    ]);
    // platform_users sin entrada → [] → no resuelve.

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 7,
      motivo: "motivo válido",
      usuario_email: "no-existe@clubcashin.com",
    });

    expect(r).toMatchObject({ success: true });
    expect(estado.inserts[0].filas[0].usuario_id).toBeNull();
  });

  it("usuario_id null cuando no se envía usuario_email", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: 2 }]);
    setBucketActual(1);
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 2, nombre: "Samuel Gamboa" },
      { asesor_id: 7, nombre: "Erik Rivas" },
    ]);

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 7,
      motivo: "motivo válido",
    });

    expect(r).toMatchObject({ success: true });
    expect(estado.inserts[0].filas[0].usuario_id).toBeNull();
  });

  it("permite reasignar un crédito sin asesor actual (asesor_id null)", async () => {
    estado.selectsPorTabla.set(schema.creditos, [{ asesor_id: null }]);
    setBucketActual(1);
    estado.selectsPorTabla.set(schema.asesor_bucket, [
      { asesor_id: 7, nombre: "Erik Rivas" },
    ]);

    const r = await reasignarAsesorManual({
      credito_id: 9116,
      asesor_nuevo_id: 7,
      motivo: "motivo válido",
    });

    expect(r).toMatchObject({ success: true, asesor_anterior: null, asesor_nuevo: 7 });
  });
});
