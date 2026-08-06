import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { aplicaDescuentaImpuestos, descuentoImpuestos } from "./taxes";

describe("descuentoImpuestos", () => {
  it("Q100 de interés → IVA 12, ISR 7, neto 81 (interés × 0.81)", () => {
    const d = descuentoImpuestos(new Big(100));
    expect(d.iva.toString()).toBe("12");
    expect(d.isr.toString()).toBe("7");
    expect(d.ajuste.toString()).toBe("-19");
    expect(d.neto.toString()).toBe("81");
  });

  it("base SIEMPRE el interés bruto: ISR e IVA no se calculan sobre el neto", () => {
    const d = descuentoImpuestos(new Big("250.50"));
    expect(d.iva.toString()).toBe(new Big("250.50").times("0.12").toString());
    expect(d.isr.toString()).toBe(new Big("250.50").times("0.07").toString());
    expect(d.neto.round(2).toString()).toBe("202.91"); // 250.50 × 0.81 = 202.905 → 202.91
  });

  it("interés 0 → todo 0", () => {
    const d = descuentoImpuestos(new Big(0));
    expect(d.iva.toString()).toBe("0");
    expect(d.isr.toString()).toBe("0");
    expect(d.neto.toString()).toBe("0");
  });

  it("interés negativo (reversa) escala igual, sin romper", () => {
    const d = descuentoImpuestos(new Big(-100));
    expect(d.neto.toString()).toBe("-81");
    expect(d.isr.toString()).toBe("-7");
  });

  it("redondeo a 2 decimales al final, no por componente", () => {
    // 10.33 × 0.81 = 8.3673 → 8.37
    const d = descuentoImpuestos(new Big("10.33"));
    expect(d.neto.round(2).toString()).toBe("8.37");
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
