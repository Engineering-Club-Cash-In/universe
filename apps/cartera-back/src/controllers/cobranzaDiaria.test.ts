import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { interesCubeResidual, efectividadPct } from "./cobranzaDiaria";

const round2 = (b: Big) => Number(b.round(2).toString());

describe("interesCubeResidual", () => {
  it("CUBE = total - Σ(parte de inversionistas no-CUBE); caso Brenda 70/30 + CUBE", () => {
    const cube = interesCubeResidual(new Big("683.82"), [
      { inversionista_id: 1, nombre: "Brenda", porcentaje_participacion_inversionista: 70, porcentaje_cash_in: 30, monto_aportado: "25324.90" },
      { inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: 0, porcentaje_cash_in: 100, monto_aportado: "20108.92" },
    ]);
    // Brenda se queda 266.80 → CUBE (residuo) = 683.82 - 266.80 = 417.02
    expect(round2(cube)).toBeCloseTo(417.02, 1);
  });

  it("un solo inversionista real 100/0 → CUBE = 0", () => {
    const cube = interesCubeResidual(new Big("500"), [
      { inversionista_id: 7, nombre: "Ana", porcentaje_participacion_inversionista: 100, porcentaje_cash_in: 0, monto_aportado: "1000" },
    ]);
    expect(round2(cube)).toBe(0);
  });

  it("sin inversionistas → CUBE = 0", () => {
    expect(round2(interesCubeResidual(new Big("500"), []))).toBe(0);
  });

  it("solo CUBE (id 86) → CUBE = total", () => {
    const cube = interesCubeResidual(new Big("500"), [
      { inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: 0, porcentaje_cash_in: 100, monto_aportado: "1000" },
    ]);
    expect(round2(cube)).toBeCloseTo(500, 1);
  });
});

describe("efectividadPct", () => {
  it("cobrado/programado", () => {
    expect(efectividadPct(new Big("9900"), new Big("12400"))).toBeCloseTo(0.7984, 4);
  });
  it("programado 0 → 0 (sin división por cero)", () => {
    expect(efectividadPct(new Big("0"), new Big("0"))).toBe(0);
  });
  it("cobrado completo → 1", () => {
    expect(efectividadPct(new Big("500"), new Big("500"))).toBe(1);
  });
});
