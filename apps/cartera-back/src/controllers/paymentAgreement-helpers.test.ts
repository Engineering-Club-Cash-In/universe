import { describe, expect, it } from "bun:test";
import { calcularProgresoConvenio } from "./paymentAgreement-helpers";

describe("calcularProgresoConvenio", () => {
  it("calcula el porcentaje de avance con 2 decimales", () => {
    expect(calcularProgresoConvenio("4318.82", "719.80")).toBe("16.67");
  });

  it("devuelve 100.00 cuando el convenio está completamente pagado", () => {
    expect(calcularProgresoConvenio("3840.00", "3840.00")).toBe("100.00");
  });

  it("devuelve 0.00 cuando no se ha pagado nada", () => {
    expect(calcularProgresoConvenio("5344.90", "0")).toBe("0.00");
  });

  it("devuelve 0.00 sin dividir por cero cuando el monto total es 0", () => {
    expect(calcularProgresoConvenio("0", "100")).toBe("0.00");
  });

  it("devuelve 0.00 sin dividir por cero cuando el monto total es negativo", () => {
    expect(calcularProgresoConvenio("-50", "10")).toBe("0.00");
  });

  it("trata monto_pagado null/undefined como 0 (columna nullable en DB)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: probando el fallback runtime ante datos nulos de la DB
    expect(calcularProgresoConvenio("1000", null as any)).toBe("0.00");
    // biome-ignore lint/suspicious/noExplicitAny: idem
    expect(calcularProgresoConvenio("1000", undefined as any)).toBe("0.00");
  });

  it("acepta montos numéricos además de strings", () => {
    expect(calcularProgresoConvenio(1000, 500)).toBe("50.00");
  });
});
