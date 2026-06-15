import { describe, expect, it } from "bun:test";
import { shouldIncobrableInstallmentBePaid } from "./registerPaymentPolicy";

describe("registerPaymentPolicy - shouldIncobrableInstallmentBePaid", () => {
  it("no aplica (null) cuando el crédito no es incobrable", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "ACTIVO",
        capital: "7744.11",
        abonoCapital: "7744.11",
      }),
    ).toBeNull();
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "MOROSO",
        capital: "1000",
        abonoCapital: "1000",
      }),
    ).toBeNull();
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: null,
        capital: "0",
        abonoCapital: "0",
      }),
    ).toBeNull();
  });

  it("marca la cuota pagada cuando el capital llega a 0 con este abono", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "2373.14",
        abonoCapital: "2373.14",
      }),
    ).toBeTrue();
  });

  it("deja la cuota pendiente si aún queda capital por recuperar", () => {
    // crédito 23: capital 7744.11, recupera un parcial de 2373.14 → falta
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "7744.11",
        abonoCapital: "2373.14",
      }),
    ).toBeFalse();
  });

  it("tolera redondeos de hasta un centavo", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "7744.11",
        abonoCapital: "7744.10",
      }),
    ).toBeTrue(); // queda 0.01, dentro de tolerancia
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "7744.13",
        abonoCapital: "7744.10",
      }),
    ).toBeFalse(); // queda 0.03, fuera de tolerancia
  });

  it("cierra la cuota aunque el capital quede levemente negativo (sobre-recuperación)", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: "100",
        abonoCapital: "150",
      }),
    ).toBeTrue();
  });

  it("trata montos nulos como 0 sin reventar", () => {
    expect(
      shouldIncobrableInstallmentBePaid({
        statusCredit: "INCOBRABLE",
        capital: null,
        abonoCapital: null,
      }),
    ).toBeTrue(); // 0 - 0 = 0 ≤ tolerancia
  });
});
