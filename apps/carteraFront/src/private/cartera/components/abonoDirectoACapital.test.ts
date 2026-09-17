import { describe, expect, it } from "bun:test";
import { montoParaAbonoDirectoACapital, motivoAbonoACapitalNoPosible } from "./abonoDirectoACapital";

// ─────────────────────────────────────────────────────────────────────────────
// "Abonar todo a Capital" mandaba la boleta ENTERA a `abono_directo_capital`,
// pero `otros` es una columna de la fila del pago y se guarda tal como vino. Con
// boleta Q1,100 y Q100 de otros, la fila quedaba con Q1,100 de capital MÁS Q100
// de otros: Q1,200 asignados contra un comprobante de Q1,100.
//
// Y no se compensa por ningún lado: el efectivo queda en −100, así que el bloque
// que acredita saldo a favor tampoco corre. La plata fantasma es neta — y el
// `otros` se factura solo como «GASTOS VARIOS» mientras el capital no, así que
// el descuadre sale a un DTE.
//
// El hermano ya lo hacía bien: `handleAbonoCapital`, la vía del modal de exceso,
// calcula el excedente a partir de `boleta − otros − mora`. O sea que la
// semántica "el capital sale de lo que queda después de otros" ya estaba
// decidida y en producción; este handler era la asimetría.
// ─────────────────────────────────────────────────────────────────────────────

describe("montoParaAbonoDirectoACapital", () => {
  it("sin otros, va la boleta completa", () => {
    expect(montoParaAbonoDirectoACapital({ boleta: 1100, otros: 0 })).toBe(1100);
  });

  it("🔴 con otros, va la boleta MENOS otros", () => {
    // Antes iban los 1100 y quedaban 1200 asignados contra la boleta.
    expect(montoParaAbonoDirectoACapital({ boleta: 1100, otros: 100 })).toBe(1000);
  });

  it("si otros se come la boleta entera, a capital no va nada", () => {
    // No puede quedar negativo: sería pedirle plata al crédito.
    expect(montoParaAbonoDirectoACapital({ boleta: 100, otros: 100 })).toBe(0);
  });

  it("ni con otros MAYOR que la boleta", () => {
    expect(montoParaAbonoDirectoACapital({ boleta: 100, otros: 300 })).toBe(0);
  });

  it("resta en centavos, sin cola de punto flotante", () => {
    expect(montoParaAbonoDirectoACapital({ boleta: 0.3, otros: 0.1 })).toBe(0.2);
  });

  it("tolera lo que venga del formulario sin envenenar el monto", () => {
    expect(
      montoParaAbonoDirectoACapital({ boleta: 1100, otros: undefined as unknown as number })
    ).toBe(1100);
  });
});

describe("motivoAbonoACapitalNoPosible", () => {
  it("🔴 con `otros` igual a la boleta NO se puede abonar: a capital no queda nada", () => {
    // Medido contra una copia de producción: el backend ACEPTA este request con
    // 200 y escribe una fila de sólo `otros` con `abono_capital = 0.00`. El
    // capital del crédito no baja un centavo, pero el asesor ve éxito.
    expect(motivoAbonoACapitalNoPosible({ boleta: 100, otros: 100 })).toContain("no queda nada");
  });

  it("con `otros` MAYOR a la boleta tampoco", () => {
    expect(motivoAbonoACapitalNoPosible({ boleta: 100, otros: 150 })).toBeTruthy();
  });

  it("lo que el redondeo deja en cero tampoco pasa", () => {
    // `100.001 − 100` da `0.001` crudo, que es "mayor a cero" y redondea a cero.
    expect(motivoAbonoACapitalNoPosible({ boleta: 100.001, otros: 100 })).toBeTruthy();
  });

  it("con `otros` menor SÍ se puede, y no estorba", () => {
    expect(motivoAbonoACapitalNoPosible({ boleta: 1100, otros: 100 })).toBeNull();
  });

  it("sin `otros` SÍ se puede", () => {
    expect(motivoAbonoACapitalNoPosible({ boleta: 1100, otros: 0 })).toBeNull();
  });

  it("el motivo NOMBRA a otros, que es el campo que el asesor tiene que bajar", () => {
    // Si el mensaje no dice qué corregir, el asesor vuelve a apretar el botón.
    expect(motivoAbonoACapitalNoPosible({ boleta: 100, otros: 100 })).toContain("Otros");
  });
});
