import { describe, expect, it, mock } from "bun:test";

// El controller importa ../database; lo mockeamos para poder importar los helpers puros.
mock.module("../database", () => ({ db: {} }));

const { esColumnaEditable, validarValores } = await import("./facturacionSnapshot");

describe("esColumnaEditable", () => {
  it("acepta columnas de valor", () => {
    expect(esColumnaEditable("capital_total")).toBe(true);
    expect(esColumnaEditable("facturacion_acumulado")).toBe(true);
    expect(esColumnaEditable("roy_hipotecario")).toBe(true);
  });
  it("rechaza columnas no editables", () => {
    expect(esColumnaEditable("id")).toBe(false);
    expect(esColumnaEditable("fecha")).toBe(false);
    expect(esColumnaEditable("anio")).toBe(false);
    expect(esColumnaEditable("bloqueado")).toBe(false);
    expect(esColumnaEditable("columna_inventada")).toBe(false);
  });
});

describe("validarValores", () => {
  it("ok con columnas válidas y números", () => {
    const r = validarValores({ capital_total: "100.50", facturacion: "0" });
    expect(r.ok).toBe(true);
    expect(r.invalidas).toEqual([]);
  });
  it("marca columna no editable", () => {
    const r = validarValores({ fecha: "2026-06-10" });
    expect(r.ok).toBe(false);
    expect(r.invalidas).toContain("fecha");
  });
  it("marca valor no numérico", () => {
    const r = validarValores({ capital_total: "abc" });
    expect(r.ok).toBe(false);
    expect(r.invalidas).toContain("capital_total");
  });
});
