import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { calcularSplitInteresPci } from "./splitInteresPci";

const round2 = (b: Big) => Number(b.round(2).toString());

describe("calcularSplitInteresPci (regular)", () => {
  it("reparte por participación × general; CUBE por cash_in; NO da residuo", () => {
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
    // general CUBE = 0.44262; 683.82 × 1.00 × 0.44262 ≈ 302.66 (SIN residuo todavía)
    expect(round2(cube.abono_interes)).toBeCloseTo(302.66, 1);
    // suma < full (queda el residuo del 30% cash_in de Brenda)
    const suma = rows.reduce((a, r) => a.plus(r.abono_interes), new Big(0));
    expect(round2(suma)).toBeLessThan(683.82);
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
