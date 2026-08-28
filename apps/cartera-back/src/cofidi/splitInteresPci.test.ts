import { describe, expect, it } from "bun:test";
import Big from "big.js";
import {
  calcularFactoresPonderadosPorMonto,
  calcularFactorPonderadoPorMonto,
	calcularPropiedadesPorMonto,
  calcularSplitInteresPci,
} from "./splitInteresPci";

const round2 = (b: Big) => Number(b.round(2).toString());

it("extrae el factor semántico monto aportado × spread", () => {
  const factor = calcularFactorPonderadoPorMonto([
    { montoAportado: "20", factor: new Big("0.8") },
    { montoAportado: "30", factor: new Big("0.6") },
    { montoAportado: "50", factor: new Big(0) },
  ]);

  expect(factor.eq("0.34")).toBe(true);
});

it("expone los factores individuales que preservan el pago PCI regular", () => {
  const factores = calcularFactoresPonderadosPorMonto([
    { montoAportado: "25324.90", factor: new Big("0.7") },
    { montoAportado: "20108.92", factor: new Big(1) },
  ]);

  expect(round2(factores[0]!)).toBeCloseTo(266.8 / 683.82, 2);
  expect(round2(factores[1]!)).toBeCloseTo(302.66 / 683.82, 2);
});

it("preserva el orden PCI factor por ownership con precisión alta", () => {
  const [ownership] = calcularPropiedadesPorMonto([
    { montoAportado: "25324.90" },
    { montoAportado: "20108.92" },
  ]);
  const rows = calcularSplitInteresPci({
    pagoAbonoInteres: new Big("123.456789"),
    pagoAbonoIva: new Big("12.3456789"),
    inversionistas: [
      { inversionista_id: 1, nombre: "Brenda", porcentaje_participacion_inversionista: 70, porcentaje_cash_in: 30, monto_aportado: "25324.90" },
      { inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: 0, porcentaje_cash_in: 100, monto_aportado: "20108.92" },
    ],
  });

  expect(ownership!.toString()).toBe("0.55740195299448736646");
  expect(rows[0]!.abono_interes.toString()).toBe("48.17");
  expect(rows[0]!.abono_iva_12.toString()).toBe("4.82");
});

describe("calcularSplitInteresPci (regular)", () => {
  it("asigna a CUBE el residuo exacto del pago regular", () => {
    // Crédito: Brenda 70% part / 30% cash_in, aportado 25324.90 ; CUBE 0% part / 100% cash_in, aportado 20108.92
    const rows = calcularSplitInteresPci({
      pagoAbonoInteres: new Big("683.82"),
      pagoAbonoIva: new Big("0"),
      inversionistas: [
        { inversionista_id: 1, nombre: "Brenda", porcentaje_participacion_inversionista: 70, porcentaje_cash_in: 30, monto_aportado: "25324.90" },
        { inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: 0, porcentaje_cash_in: 100, monto_aportado: "20108.92" },
      ],
    });
    const brenda = rows.find(r => r.inversionista_id === 1)!;
    const cube = rows.find(r => r.inversionista_id === 86)!;
    // general Brenda = 25324.90/45433.82 = 0.55738; 683.82 × 0.70 × 0.55738 ≈ 266.80
    expect(round2(brenda.abono_interes)).toBeCloseTo(266.80, 1);
    // CUBE recibe el total menos la asignación externa, no ownership × factor.
    expect(round2(cube.abono_interes)).toBe(417.01);
    const suma = rows.reduce((a, r) => a.plus(r.abono_interes), new Big(0));
    expect(round2(suma)).toBe(683.82);
  });

  it("reconcilia interés e IVA al centavo con dos externos y CUBE", () => {
    const rows = calcularSplitInteresPci({
      pagoAbonoInteres: new Big("100.01"),
      pagoAbonoIva: new Big("12.01"),
      inversionistas: [
        { inversionista_id: 1, nombre: "Inv A", porcentaje_participacion_inversionista: 80, porcentaje_cash_in: 20, monto_aportado: "30" },
        { inversionista_id: 2, nombre: "Inv B", porcentaje_participacion_inversionista: 60, porcentaje_cash_in: 40, monto_aportado: "20" },
        { inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: 0, porcentaje_cash_in: 100, monto_aportado: "50" },
      ],
    });
    const cube = rows.find((row) => row.inversionista_id === 86)!;
    expect(cube.abono_interes.toString()).toBe("64.01");
    expect(cube.abono_iva_12.toString()).toBe("7.69");
    expect(
      rows.reduce((total, row) => total.plus(row.abono_interes), new Big(0)).toString(),
    ).toBe("100.01");
    expect(
      rows.reduce((total, row) => total.plus(row.abono_iva_12), new Big(0)).toString(),
    ).toBe("12.01");
  });

  it("sin monto externo asigna 100% a CUBE", () => {
    const [cube] = calcularSplitInteresPci({
      pagoAbonoInteres: new Big("50.03"),
      pagoAbonoIva: new Big("6.01"),
      inversionistas: [
        { inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: 0, porcentaje_cash_in: 100, monto_aportado: "100" },
      ],
    });
    expect(cube!.abono_interes.toString()).toBe("50.03");
    expect(cube!.abono_iva_12.toString()).toBe("6.01");
  });

  it("incluye al inversionista self-billing (no lo omite)", () => {
    const rows = calcularSplitInteresPci({
      pagoAbonoInteres: new Big("100"),
      pagoAbonoIva: new Big("0"),
      inversionistas: [
        { inversionista_id: 2, nombre: "InvPropio", porcentaje_participacion_inversionista: 100, porcentaje_cash_in: 0, monto_aportado: "100" },
      ],
    });
    expect(rows.find(r => r.inversionista_id === 2)).toBeDefined();
  });
});
