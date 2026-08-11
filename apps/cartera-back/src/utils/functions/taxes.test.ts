import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { aplicaDescuentaImpuestos, descuentoImpuestos } from "./taxes";

describe("descuentoImpuestos", () => {
  it("Q100 de interés → solo resta ISR 7, neto 93 (interés × 0.93); IVA 12 se calcula pero NO se resta", () => {
    const d = descuentoImpuestos(new Big(100));
    expect(d.iva.toString()).toBe("12");
    expect(d.isr.toString()).toBe("7");
    expect(d.ajuste.toString()).toBe("-7");
    expect(d.neto.toString()).toBe("93");
  });

  it("base SIEMPRE el interés bruto: ISR e IVA no se calculan sobre el neto", () => {
    const d = descuentoImpuestos(new Big("250.50"));
    expect(d.iva.toString()).toBe(new Big("250.50").times("0.12").toString());
    expect(d.isr.toString()).toBe(new Big("250.50").times("0.07").toString());
    expect(d.neto.round(2).toString()).toBe("232.97"); // 250.50 × 0.93 = 232.965 → 232.97
  });

  it("interés 0 → todo 0", () => {
    const d = descuentoImpuestos(new Big(0));
    expect(d.iva.toString()).toBe("0");
    expect(d.isr.toString()).toBe("0");
    expect(d.neto.toString()).toBe("0");
  });

  it("interés negativo (reversa) escala igual, sin romper", () => {
    const d = descuentoImpuestos(new Big(-100));
    expect(d.neto.toString()).toBe("-93");
    expect(d.isr.toString()).toBe("-7");
  });

  it("redondeo a 2 decimales al final, no por componente", () => {
    // 10.33 × 0.93 = 9.6069 → 9.61
    const d = descuentoImpuestos(new Big("10.33"));
    expect(d.neto.round(2).toString()).toBe("9.61");
  });
});

describe("aplicaDescuentaImpuestos", () => {
  it("solo aplica con true explícito", () => {
    expect(aplicaDescuentaImpuestos({ descuenta_impuestos: true })).toBeTrue();
    expect(aplicaDescuentaImpuestos({ descuenta_impuestos: false })).toBeFalse();
    expect(aplicaDescuentaImpuestos({ descuenta_impuestos: null })).toBeFalse();
    expect(aplicaDescuentaImpuestos({})).toBeFalse();
    expect(aplicaDescuentaImpuestos({ descuenta_impuestos: "true" as any })).toBeFalse();
  });
});
