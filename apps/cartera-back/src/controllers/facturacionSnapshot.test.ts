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

const { calcularAcumuladosCorridos } = await import("./facturacionSnapshot");

describe("calcularAcumuladosCorridos", () => {
  it("suma corrida e ignora bloqueados para escribir, pero incluye sus diarias", () => {
    const dias = [
      { fecha: "2026-06-01", bloqueado: false, facturacion: "100", servicios_seguro_gps: "10", facturacion_inversionistas: "5", ingreso_carros: "0" },
      { fecha: "2026-06-02", bloqueado: true,  facturacion: "200", servicios_seguro_gps: "20", facturacion_inversionistas: "5", ingreso_carros: "0" },
      { fecha: "2026-06-03", bloqueado: false, facturacion: "300", servicios_seguro_gps: "30", facturacion_inversionistas: "5", ingreso_carros: "1" },
    ];
    const r = calcularAcumuladosCorridos(dias);
    // El día 2 (bloqueado) NO genera update.
    expect(r.map((u) => u.fecha)).toEqual(["2026-06-01", "2026-06-03"]);
    // Día 1: fact_acum=100
    expect(r[0].facturacion_acumulado).toBe("100.00");
    // Día 3: incluye el día 2 bloqueado → 100+200+300 = 600
    expect(r[1].facturacion_acumulado).toBe("600.00");
    expect(r[1].acum_servicios_seguro_gps).toBe("60.00");
    expect(r[1].acumulado_inversionistas).toBe("15.00");
    // acumulado_total = fact_acum + serv_acum + carros_acum = 600+60+1 = 661
    expect(r[1].acumulado_total).toBe("661.00");
  });
});
