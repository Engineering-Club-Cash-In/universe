import { describe, expect, it } from "bun:test";
import { calcularTotalConvenioCuotas } from "./paymentAgreementPolicy";

const installments = [
  { cuota_id: 101, numero_cuota: 1 },
  { cuota_id: 102, numero_cuota: 2 },
  { cuota_id: 103, numero_cuota: 3 },
];

describe("calcularTotalConvenioCuotas", () => {
  it("incluye el ajuste únicamente cuando el convenio selecciona cuota 1", () => {
    expect(
      calcularTotalConvenioCuotas({
        selectedInstallmentIds: [101, 102],
        installments,
        regularInstallmentAmount: 300,
        firstInstallmentAmount: 330,
        lateFee: 20,
      }),
    ).toBe(650);
  });

  it("no agrega el ajuste si solo selecciona cuotas posteriores", () => {
    expect(
      calcularTotalConvenioCuotas({
        selectedInstallmentIds: [102, 103],
        installments,
        regularInstallmentAmount: 300,
        firstInstallmentAmount: 330,
        lateFee: 20,
      }),
    ).toBe(620);
  });

  it("conserva el cálculo anterior cuando cuota 1 no tiene ajuste", () => {
    expect(
      calcularTotalConvenioCuotas({
        selectedInstallmentIds: [101, 102],
        installments,
        regularInstallmentAmount: 300,
        firstInstallmentAmount: 300,
        lateFee: 0,
      }),
    ).toBe(600);
  });
});
