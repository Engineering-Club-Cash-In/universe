import { describe, expect, it } from "bun:test";
import * as installmentContribution from "./installmentContribution";

const getDisplayedContribution = () =>
  Reflect.get(installmentContribution, "getDisplayedPartialContribution");

describe("getDisplayedPartialContribution", () => {
  it("resta únicamente un abono parcial real de una cuota abierta", () => {
    const getContribution = getDisplayedContribution();
    expect(getContribution).toBeFunction();
    if (typeof getContribution !== "function") return;

    expect(
      getContribution({
        cuota_cerrada: false,
        total_aplicado_cuota: "40.00",
        saldo_pendiente: "60.00",
        tiene_abono_parcial: true,
      }),
    ).toBe(40);
  });

  it("devuelve cero para cuota cerrada, pago completo o placeholder", () => {
    const getContribution = getDisplayedContribution();
    expect(getContribution).toBeFunction();
    if (typeof getContribution !== "function") return;

    expect(
      getContribution({
        cuota_cerrada: true,
        total_aplicado_cuota: "100.00",
        saldo_pendiente: "0.00",
        tiene_abono_parcial: false,
      }),
    ).toBe(0);
    expect(
      getContribution({
        cuota_cerrada: false,
        total_aplicado_cuota: "100.00",
        saldo_pendiente: "0.00",
        tiene_abono_parcial: false,
      }),
    ).toBe(0);
    expect(
      getContribution({
        cuota_cerrada: false,
        total_aplicado_cuota: "0.00",
        saldo_pendiente: "100.00",
        tiene_abono_parcial: false,
      }),
    ).toBe(0);
  });
});
