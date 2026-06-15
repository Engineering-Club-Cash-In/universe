import { describe, expect, it } from "bun:test";
import {
  getRemainingPaymentPaidStatusAfterReversal,
  isCreditStatusReversible,
  shouldInstallmentRemainPaidAfterReversal,
  shouldRemoveSameInstallmentPaymentOnReverse,
} from "./reversePaymentPolicy";

describe("reverse payment policy", () => {
  it("no elimina otros pagos reales de la misma cuota al reversar un pago", () => {
    expect(
      shouldRemoveSameInstallmentPaymentOnReverse({
        pago_id: 101,
        monto_aplicado: "1500.00",
        monto_boleta: "1500.00",
        validationStatus: "validated",
        paymentFalse: false,
        pagado: true,
      }),
    ).toBeFalse();
  });

  it("solo considera removible un placeholder sin monto real", () => {
    expect(
      shouldRemoveSameInstallmentPaymentOnReverse({
        pago_id: 102,
        monto_aplicado: "0.00",
        monto_boleta: "0.00",
        validationStatus: "no_required",
        paymentFalse: false,
        pagado: false,
      }),
    ).toBeTrue();
  });

  it("mantiene la cuota pagada si los pagos restantes aun cubren la cuota", () => {
    expect(
      shouldInstallmentRemainPaidAfterReversal({
        cuota: "2445.18",
        remainingPayments: [
          { monto_aplicado: "1500.00", validationStatus: "validated", paymentFalse: false },
          { monto_aplicado: "945.18", validationStatus: "validated", paymentFalse: false },
        ],
      }),
    ).toBeTrue();
  });

  it("marca la cuota como no pagada si los pagos restantes no cubren la cuota", () => {
    expect(
      shouldInstallmentRemainPaidAfterReversal({
        cuota: "2445.18",
        remainingPayments: [
          { monto_aplicado: "500.00", validationStatus: "validated", paymentFalse: false },
          { monto_aplicado: "445.18", validationStatus: "pending", paymentFalse: false },
        ],
      }),
    ).toBeFalse();
  });

  it("marca la cuota como no pagada si falta un centavo", () => {
    expect(
      shouldInstallmentRemainPaidAfterReversal({
        cuota: "2445.18",
        remainingPayments: [
          { monto_aplicado: "2445.17", validationStatus: "validated", paymentFalse: false },
        ],
      }),
    ).toBeFalse();
  });

  it("marca los pagos restantes igual que el estado recalculado de la cuota", () => {
    expect(getRemainingPaymentPaidStatusAfterReversal(true)).toBeTrue();
    expect(getRemainingPaymentPaidStatusAfterReversal(false)).toBeFalse();
  });

  it("permite reversar pagos en creditos activos, en mora, en convenio e incobrables", () => {
    expect(isCreditStatusReversible("ACTIVO")).toBeTrue();
    expect(isCreditStatusReversible("MOROSO")).toBeTrue();
    expect(isCreditStatusReversible("EN_CONVENIO")).toBeTrue();
    expect(isCreditStatusReversible("INCOBRABLE")).toBeTrue();
  });

  it("bloquea reversar pagos en creditos en estado de cierre o sin estado", () => {
    expect(isCreditStatusReversible("CANCELADO")).toBeFalse();
    expect(isCreditStatusReversible("PENDIENTE_CANCELACION")).toBeFalse();
    expect(isCreditStatusReversible("CAIDO")).toBeFalse();
    expect(isCreditStatusReversible(null)).toBeFalse();
    expect(isCreditStatusReversible(undefined)).toBeFalse();
  });
});
