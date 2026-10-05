import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { calcularFactoresProrrateoInteresV2 } from "./prorrateoPciInteres";

const CUBE_ID = 86;
const COMPRADOR_ID = 165;

// CUBE vende toda su posición (Q1,000) al comprador. Los factores esperados son
// entonces: CUBE = fracción ANTES del corte, comprador = fracción DESPUÉS.
const escenarioVentaTotal = (fechaCorte: Date) =>
  calcularFactoresProrrateoInteresV2({
    inversionistas: [
      {
        inversionista_id: CUBE_ID,
        nombre: "Cube Investments S.A.",
        porcentaje_participacion: 0,
        porcentaje_cash_in: 100,
        monto_aportado_espejo: "0",
      },
      {
        inversionista_id: COMPRADOR_ID,
        nombre: "Inversionista Comprador",
        porcentaje_participacion: 100,
        porcentaje_cash_in: 0,
        monto_aportado_espejo: "1000",
      },
    ],
    idComprador: COMPRADOR_ID,
    montoComprado: "1000",
    fechaCorte,
  });

describe("calcularFactoresProrrateoInteresV2 — piso de 1 día", () => {
  it("corte a mitad de mes: reparte por días, sin cambios respecto al cálculo previo", () => {
    const f = escenarioVentaTotal(new Date("2026-01-15T00:00:00Z"));

    // 31 días de enero, corte el 15 → 15 antes / 16 después.
    expect(f.get(CUBE_ID)!.eq(new Big(15).div(31))).toBe(true);
    expect(f.get(COMPRADOR_ID)!.eq(new Big(16).div(31))).toBe(true);
  });

  it("corte el ÚLTIMO día del mes: el comprador recibe 1 día, no 0", () => {
    const f = escenarioVentaTotal(new Date("2026-01-31T00:00:00Z"));

    // Sin el piso, ultimoDiaMes - diaCorte = 0 y el comprador quedaba en cero
    // mientras CUBE se llevaba el mes entero.
    expect(f.get(COMPRADOR_ID)!.eq(new Big(1).div(31))).toBe(true);
    expect(f.get(CUBE_ID)!.eq(new Big(30).div(31))).toBe(true);
  });

  it("febrero de año bisiesto: el piso usa los días reales del mes", () => {
    const f = escenarioVentaTotal(new Date("2028-02-29T00:00:00Z"));

    expect(f.get(COMPRADOR_ID)!.eq(new Big(1).div(29))).toBe(true);
    expect(f.get(CUBE_ID)!.eq(new Big(28).div(29))).toBe(true);
  });

  it("las dos ventanas siguen sumando exactamente 1", () => {
    for (const fecha of ["2026-01-01", "2026-01-15", "2026-01-31", "2026-02-28"]) {
      const f = escenarioVentaTotal(new Date(`${fecha}T00:00:00Z`));
      const suma = [...f.values()].reduce((a, b) => a.plus(b), new Big(0));
      expect(suma.eq(1)).toBe(true);
    }
  });
});
