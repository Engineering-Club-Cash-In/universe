import { describe, expect, it, mock } from "bun:test";

// El controller importa ../database; lo mockeamos para poder importar los helpers puros.
mock.module("../database", () => ({ db: {}, client: {} }));

const { esColumnaEditable, validarValores } = await import("./facturacionSnapshot");

describe("esColumnaEditable", () => {
  it("acepta TODO Royalty y TODO Otros ingresos (detalle + total)", () => {
    expect(esColumnaEditable("royalty")).toBe(true);
    expect(esColumnaEditable("roy_hipotecario")).toBe(true);
    expect(esColumnaEditable("nuevo_roy_autocompras")).toBe(true);
    expect(esColumnaEditable("otros_ingresos")).toBe(true);
    expect(esColumnaEditable("oi_autocompras")).toBe(true);
    expect(esColumnaEditable("administrativos")).toBe(true);
    expect(esColumnaEditable("otros_cobros")).toBe(true);
  });
  it("rechaza Capital/Interés/Membresía/Mora, servicios, metas y acumulados", () => {
    expect(esColumnaEditable("id")).toBe(false);
    expect(esColumnaEditable("fecha")).toBe(false);
    expect(esColumnaEditable("bloqueado")).toBe(false);
    expect(esColumnaEditable("capital_total")).toBe(false);
    expect(esColumnaEditable("interes_cube")).toBe(false);
    expect(esColumnaEditable("membresia")).toBe(false);
    expect(esColumnaEditable("mora_cube")).toBe(false);
    expect(esColumnaEditable("facturacion")).toBe(false); // se DERIVA de rubros
    expect(esColumnaEditable("servicios_seguro_gps")).toBe(false);
    expect(esColumnaEditable("ingreso_carros")).toBe(false);
    expect(esColumnaEditable("meta_facturacion_diaria")).toBe(false);
    expect(esColumnaEditable("facturacion_acumulado")).toBe(false);
    expect(esColumnaEditable("acumulado_total")).toBe(false);
    expect(esColumnaEditable("porcentaje_meta_mensual")).toBe(false);
    expect(esColumnaEditable("columna_inventada")).toBe(false);
  });
});

describe("validarValores", () => {
  it("ok con rubros editables y números", () => {
    const r = validarValores({ royalty: "100.50", otros_ingresos: "0" });
    expect(r.ok).toBe(true);
    expect(r.invalidas).toEqual([]);
  });
  it("marca columna no editable", () => {
    const r = validarValores({ capital_total: "100" });
    expect(r.ok).toBe(false);
    expect(r.invalidas).toContain("capital_total");
  });
  it("marca valor no numérico", () => {
    const r = validarValores({ royalty: "abc" });
    expect(r.ok).toBe(false);
    expect(r.invalidas).toContain("royalty");
  });
});

const { calcularAcumuladosCorridos } = await import("./facturacionSnapshot");

describe("calcularAcumuladosCorridos", () => {
  it("suma corrida para TODOS los días (incl. bloqueado) → acumulados siempre suman", () => {
    const dias = [
      { fecha: "2026-06-01", bloqueado: false, facturacion: "100", servicios_seguro_gps: "10", facturacion_inversionistas: "5", ingreso_carros: "0" },
      { fecha: "2026-06-02", bloqueado: true,  facturacion: "200", servicios_seguro_gps: "20", facturacion_inversionistas: "5", ingreso_carros: "0" },
      { fecha: "2026-06-03", bloqueado: false, facturacion: "300", servicios_seguro_gps: "30", facturacion_inversionistas: "5", ingreso_carros: "1" },
    ];
    const r = calcularAcumuladosCorridos(dias);
    // Todos los días emiten update (incl. el bloqueado) — sin discontinuidad.
    expect(r.map((u) => u.fecha)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    // Día 1: 100
    expect(r[0].facturacion_acumulado).toBe("100.00");
    // Día 2 (bloqueado, pero su acumulado SÍ se calcula): 100+200 = 300
    expect(r[1].facturacion_acumulado).toBe("300.00");
    expect(r[1].acumulado_total).toBe("330.00"); // 300 + 30(serv) + 0(carros)
    // Día 3: 100+200+300 = 600
    expect(r[2].facturacion_acumulado).toBe("600.00");
    expect(r[2].acum_servicios_seguro_gps).toBe("60.00");
    expect(r[2].acumulado_inversionistas).toBe("15.00");
    // acumulado_total = 600 + 60(serv) + 1(carros) = 661
    expect(r[2].acumulado_total).toBe("661.00");
  });
});

describe("validarValores numérico estricto", () => {
  it("rechaza notación científica, hex y comas", () => {
    expect(validarValores({ royalty: "1e3" }).ok).toBe(false);
    expect(validarValores({ royalty: "0x10" }).ok).toBe(false);
    expect(validarValores({ royalty: "1,000" }).ok).toBe(false);
  });
  it("acepta decimal plano con espacios y signo", () => {
    expect(validarValores({ royalty: " 1000 " }).ok).toBe(true);
    expect(validarValores({ royalty: "-12.50" }).ok).toBe(true);
    expect(validarValores({ royalty: "0" }).ok).toBe(true);
  });
});
