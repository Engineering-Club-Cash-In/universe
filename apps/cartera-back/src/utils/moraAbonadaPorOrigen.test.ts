import { describe, it, expect } from "bun:test";
import Big from "big.js";
import { clasificarPorOrigen } from "./moraAbonadaPorOrigen";

describe("clasificarPorOrigen", () => {
  it("sums PAGO entries to pagada", () => {
    const filas = [
      { monto: "100", tipo: "PAGO", tipo_origen: null },
      { monto: "50", tipo: "PAGO", tipo_origen: null },
    ];
    const result = clasificarPorOrigen(filas);
    expect(result.pagada.toFixed(2)).toBe("150.00");
    expect(result.condonada.toFixed(2)).toBe("0.00");
  });

  it("sums CONDONACION entries to condonada", () => {
    const filas = [
      { monto: "100", tipo: "CONDONACION", tipo_origen: null },
      { monto: "50", tipo: "CONDONACION", tipo_origen: null },
    ];
    const result = clasificarPorOrigen(filas);
    expect(result.pagada.toFixed(2)).toBe("0.00");
    expect(result.condonada.toFixed(2)).toBe("150.00");
  });

  it("classifies REVERSA by the tipo_origen it reverts", () => {
    // REVERSA que revierte un PAGO: resta de pagada
    const filas = [
      { monto: "100", tipo: "PAGO", tipo_origen: null },
      { monto: "-100", tipo: "REVERSA", tipo_origen: "PAGO" },
    ];
    const result = clasificarPorOrigen(filas);
    expect(result.pagada.toFixed(2)).toBe("0.00");
    expect(result.condonada.toFixed(2)).toBe("0.00");
  });

  it("classifies REVERSA of CONDONACION correctly", () => {
    // REVERSA que revierte una CONDONACION: resta de condonada
    const filas = [
      { monto: "50", tipo: "CONDONACION", tipo_origen: null },
      { monto: "-50", tipo: "REVERSA", tipo_origen: "CONDONACION" },
    ];
    const result = clasificarPorOrigen(filas);
    expect(result.pagada.toFixed(2)).toBe("0.00");
    expect(result.condonada.toFixed(2)).toBe("0.00");
  });

  it("handles mixed transactions correctly", () => {
    // Scenario: PAGO 100 + CONDONACION 50 + REVERSA −100 (reverts PAGO)
    const filas = [
      { monto: "100", tipo: "PAGO", tipo_origen: null },
      { monto: "50", tipo: "CONDONACION", tipo_origen: null },
      { monto: "-100", tipo: "REVERSA", tipo_origen: "PAGO" },
    ];
    const result = clasificarPorOrigen(filas);
    // pagada: 100 - 100 = 0
    // condonada: 50
    expect(result.pagada.toFixed(2)).toBe("0.00");
    expect(result.condonada.toFixed(2)).toBe("50.00");
  });

  it("handles ANULACION entries", () => {
    // ANULACION is like REVERSA but for other scenarios
    const filas = [
      { monto: "100", tipo: "PAGO", tipo_origen: null },
      { monto: "-100", tipo: "ANULACION", tipo_origen: "PAGO" },
    ];
    const result = clasificarPorOrigen(filas);
    expect(result.pagada.toFixed(2)).toBe("0.00");
    expect(result.condonada.toFixed(2)).toBe("0.00");
  });

  it("returns empty sums for empty input", () => {
    const result = clasificarPorOrigen([]);
    expect(result.pagada.toFixed(2)).toBe("0.00");
    expect(result.condonada.toFixed(2)).toBe("0.00");
  });

  it("handles decimal amounts correctly", () => {
    const filas = [
      { monto: "123.45", tipo: "PAGO", tipo_origen: null },
      { monto: "67.89", tipo: "CONDONACION", tipo_origen: null },
      { monto: "-23.45", tipo: "REVERSA", tipo_origen: "PAGO" },
    ];
    const result = clasificarPorOrigen(filas);
    expect(result.pagada.toFixed(2)).toBe("100.00");
    expect(result.condonada.toFixed(2)).toBe("67.89");
  });
});
