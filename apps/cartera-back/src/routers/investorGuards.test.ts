import { describe, expect, it } from "bun:test";
import { bodyTraeDescuentaImpuestos, guardDescuentaImpuestos } from "./investorGuards";

describe("bodyTraeDescuentaImpuestos", () => {
  it("detecta el campo en objeto y en array", () => {
    expect(bodyTraeDescuentaImpuestos({ descuenta_impuestos: true })).toBeTrue();
    expect(bodyTraeDescuentaImpuestos({ descuenta_impuestos: false })).toBeTrue();
    expect(bodyTraeDescuentaImpuestos([{ nombre: "A" }, { descuenta_impuestos: true }])).toBeTrue();
    expect(bodyTraeDescuentaImpuestos({ nombre: "A" })).toBeFalse();
    expect(bodyTraeDescuentaImpuestos([{ nombre: "A" }])).toBeFalse();
    expect(bodyTraeDescuentaImpuestos(null)).toBeFalse();
  });
});

describe("guardDescuentaImpuestos", () => {
  it("sin el campo: pasa cualquier rol", () => {
    const set = { status: 200 };
    expect(guardDescuentaImpuestos({ body: { nombre: "A" }, user: { role: "ASESOR" }, set })).toBeNull();
    expect(set.status).toBe(200);
  });

  it("con el campo y rol no ADMIN: 403", () => {
    const set = { status: 200 };
    const res = guardDescuentaImpuestos({
      body: { descuenta_impuestos: true },
      user: { role: "ASESOR" },
      set,
    });
    expect(res).toEqual({ message: "Solo ADMIN puede modificar descuenta_impuestos" });
    expect(set.status).toBe(403);
  });

  it("con el campo y sin user: 403", () => {
    const set = { status: 200 };
    expect(guardDescuentaImpuestos({ body: { descuenta_impuestos: false }, set })).not.toBeNull();
    expect(set.status).toBe(403);
  });

  it("con el campo y ADMIN: pasa", () => {
    const set = { status: 200 };
    expect(
      guardDescuentaImpuestos({ body: [{ descuenta_impuestos: true }], user: { role: "ADMIN" }, set })
    ).toBeNull();
    expect(set.status).toBe(200);
  });
});
