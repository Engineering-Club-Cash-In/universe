import { describe, expect, it } from "bun:test";
import { saldoAFavorAcreditadoPorPagoDeCapital } from "./saldoAFavorCapital";

// ─────────────────────────────────────────────────────────────────────────────
// La rama de abono directo a capital acredita a `saldo_a_favor` lo que le SOBRA
// —`boleta − otros − abono_capital`, y sólo si es positivo—, pero la reversa le
// descuenta el `monto_boleta` COMPLETO. La asimetría le arranca saldo a favor a
// un usuario al que ese pago no le acreditó nada.
//
// Hasta ahora el descuadre estaba tapado por otro: la fila guardaba
// `monto_boleta = abono_capital`, así que con `otros = 0` los dos números
// coincidían por casualidad. Al persistir la boleta REAL —que es lo que el
// recibo imprime y lo que dice el comprobante del banco— la asimetría queda a la
// vista, y hay que cerrar las dos juntas o una empeora a la otra.
//
// Se calcula en vez de guardarse porque los tres términos ya están en la fila:
// menos columnas y nada que se desincronice.
// ─────────────────────────────────────────────────────────────────────────────

const fila = (over: Record<string, unknown> = {}) => ({
  monto_boleta: "1100.00",
  otros: "0",
  abono_capital: "1100.00",
  ...over,
});

describe("saldoAFavorAcreditadoPorPagoDeCapital", () => {
  it("sin sobrante no acreditó nada, así que no hay nada que devolver", () => {
    // Boleta 1100, otros 100, a capital 1000: la boleta se reparte entera.
    expect(
      saldoAFavorAcreditadoPorPagoDeCapital(
        fila({ otros: "100.00", abono_capital: "1000.00" })
      ).toString()
    ).toBe("0");
  });

  it("lo que sobró es lo que se devuelve", () => {
    // Boleta 1100, otros 100, a capital 900 → sobraron 100.
    expect(
      saldoAFavorAcreditadoPorPagoDeCapital(
        fila({ otros: "100.00", abono_capital: "900.00" })
      ).toString()
    ).toBe("100");
  });

  it("sin otros y con la boleta entera a capital, tampoco sobra", () => {
    expect(saldoAFavorAcreditadoPorPagoDeCapital(fila()).toString()).toBe("0");
  });

  it("🔴 nunca negativo: un pago no puede QUITAR saldo a favor al revertirse", () => {
    // La sobreasignación vieja (capital = boleta entera CON otros encima) daba
    // −100. Devolver un negativo le SUMARÍA saldo a favor a quien revierte.
    expect(
      saldoAFavorAcreditadoPorPagoDeCapital(
        fila({ otros: "100.00", abono_capital: "1100.00" })
      ).toString()
    ).toBe("0");
  });

  it("tolera los nulos de las columnas", () => {
    expect(
      saldoAFavorAcreditadoPorPagoDeCapital({
        monto_boleta: "500.00",
        otros: null,
        abono_capital: null,
      }).toString()
    ).toBe("500");
  });

  it("no pierde centavos", () => {
    expect(
      saldoAFavorAcreditadoPorPagoDeCapital(
        fila({ monto_boleta: "1000.05", otros: "0.05", abono_capital: "900.00" })
      ).toString()
    ).toBe("100");
  });
});
