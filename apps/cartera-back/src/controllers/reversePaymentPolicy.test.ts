import { describe, expect, it } from "bun:test";
import {
  getRemainingPaymentPaidStatusAfterReversal,
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

  it("marca los pagos restantes igual que el estado recalculado de la cuota", () => {
    expect(getRemainingPaymentPaidStatusAfterReversal(true)).toBeTrue();
    expect(getRemainingPaymentPaidStatusAfterReversal(false)).toBeFalse();
  });
});
