import { describe, expect, it } from "bun:test";
import { decidirAjusteAlReconstruirCuota1 } from "./ajusteFechaIdealPago";

describe("decidirAjusteAlReconstruirCuota1", () => {
  it("no hace nada si la reconstrucción no llega a la cuota 1", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 0,
        ajustePrevio: { id: 1, montoTotal: "30.00", fechaCobro: null },
      }),
    ).toEqual({ kind: "ninguna" });
  });

  it("no hace nada si el crédito no tiene ningún ajuste", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 3,
        ajustePrevio: null,
      }),
    ).toEqual({ kind: "ninguna" });
  });

  it("reengancha si el ajuste ya tenía fecha_cobro (se cobró de verdad antes)", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 1,
        ajustePrevio: { id: 7, montoTotal: "30.00", fechaCobro: new Date("2026-01-15") },
      }),
    ).toEqual({ kind: "reenganchar", ajusteId: 7, montoTotal: "30.00" });
  });

  it("reabre si el ajuste nunca se cobró (sin evidencia de que haya entrado)", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 1,
        ajustePrevio: { id: 7, montoTotal: "30.00", fechaCobro: null },
      }),
    ).toEqual({ kind: "reabrir" });
  });

  it("reengancha aunque hastaCuota cubra más cuotas, mientras incluya la 1", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 5,
        ajustePrevio: { id: 9, montoTotal: "12.34", fechaCobro: new Date() },
      }),
    ).toEqual({ kind: "reenganchar", ajusteId: 9, montoTotal: "12.34" });
  });
});
