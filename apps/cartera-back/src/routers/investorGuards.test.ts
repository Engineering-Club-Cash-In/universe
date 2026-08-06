import { beforeEach, describe, expect, it, mock } from "bun:test";

// Valor guardado que devuelve la BD mockeada para el inversionista consultado.
let storedFlag: boolean | undefined = false;

mock.module("../database/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              storedFlag === undefined ? [] : [{ descuenta_impuestos: storedFlag }]
            ),
        }),
      }),
    }),
  },
}));

const { guardDescuentaImpuestos, intentaCambiarDescuentaImpuestos } = await import(
  "./investorGuards"
);

describe("intentaCambiarDescuentaImpuestos", () => {
  beforeEach(() => {
    storedFlag = false;
  });

  it("body sin el campo → no es cambio", async () => {
    expect(await intentaCambiarDescuentaImpuestos({ nombre: "A" })).toBeFalse();
  });

  it("update con el MISMO valor que la BD → no es cambio (modal manda default)", async () => {
    storedFlag = false;
    expect(
      await intentaCambiarDescuentaImpuestos({ inversionista_id: 10, descuenta_impuestos: false })
    ).toBeFalse();
  });

  it("update que CAMBIA el valor → sí es cambio", async () => {
    storedFlag = false;
    expect(
      await intentaCambiarDescuentaImpuestos({ inversionista_id: 10, descuenta_impuestos: true })
    ).toBeTrue();
  });

  it("create (sin id) con true → cambio; con false → no", async () => {
    expect(await intentaCambiarDescuentaImpuestos({ descuenta_impuestos: true })).toBeTrue();
    expect(await intentaCambiarDescuentaImpuestos({ descuenta_impuestos: false })).toBeFalse();
  });

  it("valor no booleano se ignora", async () => {
    expect(
      await intentaCambiarDescuentaImpuestos({ inversionista_id: 10, descuenta_impuestos: null })
    ).toBeFalse();
  });

  it("array: detecta el cambio en cualquier elemento", async () => {
    storedFlag = false;
    expect(
      await intentaCambiarDescuentaImpuestos([
        { nombre: "A" },
        { inversionista_id: 10, descuenta_impuestos: true },
      ])
    ).toBeTrue();
  });
});

describe("guardDescuentaImpuestos", () => {
  beforeEach(() => {
    storedFlag = false;
  });

  it("no-ADMIN guardando SIN cambiar el flag → pasa (no 403)", async () => {
    storedFlag = false;
    const set = { status: 200 };
    const res = await guardDescuentaImpuestos({
      body: { inversionista_id: 10, nombre: "editado", descuenta_impuestos: false },
      user: { role: "ASESOR" },
      set,
    });
    expect(res).toBeNull();
    expect(set.status).toBe(200);
  });

  it("no-ADMIN intentando CAMBIAR el flag → 403", async () => {
    storedFlag = false;
    const set = { status: 200 };
    const res = await guardDescuentaImpuestos({
      body: { inversionista_id: 10, descuenta_impuestos: true },
      user: { role: "ASESOR" },
      set,
    });
    expect(res).toEqual({ message: "Solo ADMIN puede modificar descuenta_impuestos" });
    expect(set.status).toBe(403);
  });

  it("ADMIN cambiando el flag → pasa sin tocar la BD", async () => {
    storedFlag = false;
    const set = { status: 200 };
    expect(
      await guardDescuentaImpuestos({
        body: { inversionista_id: 10, descuenta_impuestos: true },
        user: { role: "ADMIN" },
        set,
      })
    ).toBeNull();
    expect(set.status).toBe(200);
  });
});
