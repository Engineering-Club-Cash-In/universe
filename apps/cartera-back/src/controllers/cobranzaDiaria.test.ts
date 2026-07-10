import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { interesCubeResidual, efectividadPct, agruparPorAsesor, type CobranzaCreditoRow } from "./cobranzaDiaria";

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

const rubro = (v: string): import("./cobranzaDiaria").RubroMontos => ({
  capital: v,
  interes: v,
  iva: "0",
  seguro: "0",
  gps: "0",
  membresia: "0",
});

const credito = (over: Partial<CobranzaCreditoRow>): CobranzaCreditoRow => ({
  credito_id: 1,
  numero_credito_sifco: "X",
  cliente_nombre: "C",
  asesor_id: 10,
  asesor_nombre: "Sam",
  cobrado: rubro("0"),
  restante: rubro("0"),
  cube: { esperado: "0", cobrado: "0" },
  mora_cobrada: "0",
  total_cobrado: "0",
  total_esperado: "0",
  ...over,
});

describe("agruparPorAsesor", () => {
  it("suma dos créditos del mismo asesor y calcula efectividad", () => {
    const { asesores, totalGeneral } = agruparPorAsesor([
      credito({ credito_id: 1, total_cobrado: "600", total_esperado: "400" }),
      credito({ credito_id: 2, total_cobrado: "300", total_esperado: "700" }),
    ]);
    expect(asesores).toHaveLength(1);
    expect(asesores[0].cuotas).toBe(2);
    expect(asesores[0].total_cobrado).toBe("900.00");
    expect(asesores[0].total_esperado).toBe("1100.00");
    expect(asesores[0].programado).toBe("2000.00");
    expect(asesores[0].efectividad).toBeCloseTo(0.45, 4);
    expect(totalGeneral.total_cobrado).toBe("900.00");
  });

  it("separa por asesor y el total general suma todos", () => {
    const { asesores, totalGeneral } = agruparPorAsesor([
      credito({ credito_id: 1, asesor_id: 10, asesor_nombre: "Sam", total_cobrado: "100", total_esperado: "0" }),
      credito({ credito_id: 2, asesor_id: 20, asesor_nombre: "Wil", total_cobrado: "50", total_esperado: "50" }),
    ]);
    expect(asesores).toHaveLength(2);
    expect(totalGeneral.total_cobrado).toBe("150.00");
    expect(totalGeneral.total_esperado).toBe("50.00");
    expect(totalGeneral.cuotas).toBe(2);
  });
});
