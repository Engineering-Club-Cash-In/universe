import { describe, expect, it } from "bun:test";
import { guardDescuentaImpuestos, stripDescuentaImpuestos } from "./investorGuards";

describe("stripDescuentaImpuestos", () => {
  it("quita el campo de un objeto", () => {
    const body: any = { nombre: "A", descuenta_impuestos: true };
    expect(stripDescuentaImpuestos(body)).toBeTrue();
    expect("descuenta_impuestos" in body).toBeFalse();
    expect(body.nombre).toBe("A");
  });

  it("quita el campo de cada elemento de un array", () => {
    const body: any = [{ descuenta_impuestos: false }, { nombre: "B" }, { descuenta_impuestos: true }];
    expect(stripDescuentaImpuestos(body)).toBeTrue();
    expect("descuenta_impuestos" in body[0]).toBeFalse();
    expect("descuenta_impuestos" in body[2]).toBeFalse();
  });

  it("no toca un body sin el campo", () => {
    const body: any = { nombre: "A" };
    expect(stripDescuentaImpuestos(body)).toBeFalse();
    expect(body).toEqual({ nombre: "A" });
  });
});

describe("guardDescuentaImpuestos", () => {
  it("ADMIN: el campo se conserva intacto", () => {
    const body: any = { inversionista_id: 10, descuenta_impuestos: true };
    guardDescuentaImpuestos({ body, user: { role: "ADMIN" } });
    expect(body.descuenta_impuestos).toBe(true);
  });

  it("no-ADMIN con id: el campo se elimina (no puede cambiarlo por ningún camino)", () => {
    const body: any = { inversionista_id: 10, descuenta_impuestos: true };
    guardDescuentaImpuestos({ body, user: { role: "ASESOR" } });
    expect("descuenta_impuestos" in body).toBeFalse();
    expect(body.inversionista_id).toBe(10);
  });

  it("no-ADMIN SIN id (upsert legacy por DPI/email): también se elimina", () => {
    const body: any = { email: "x@y.com", descuenta_impuestos: false };
    guardDescuentaImpuestos({ body, user: { role: "ASESOR" } });
    expect("descuenta_impuestos" in body).toBeFalse();
  });

  it("no-ADMIN sin usuario: se elimina", () => {
    const body: any = [{ descuenta_impuestos: true }];
    guardDescuentaImpuestos({ body });
    expect("descuenta_impuestos" in body[0]).toBeFalse();
  });

  it("no-ADMIN sin el campo: no rompe nada", () => {
    const body: any = { nombre: "A" };
    guardDescuentaImpuestos({ body, user: { role: "ASESOR" } });
    expect(body).toEqual({ nombre: "A" });
  });
});
