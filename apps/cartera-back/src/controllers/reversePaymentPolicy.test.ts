import { describe, expect, it } from "bun:test";
import {
  getRemainingPaymentPaidStatusAfterReversal,
  isCreditStatusReversible,
  isReversibleIncobrablePayment,
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

describe("isReversibleIncobrablePayment", () => {
  it("permite reversar pagos de recuperación reales (usuario, pending/validated)", () => {
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "validated",
        registerBy: "caren.r@sepresta.com",
      }),
    ).toBeTrue();
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "pending",
        registerBy: "caren.r@sepresta.com",
      }),
    ).toBeTrue();
  });

  it("bloquea filas estructurales del castigo (system_reset, aun estando validated)", () => {
    // crédito 23 / pago 121102: validated pero system_reset → NO reversable
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "validated",
        registerBy: "system_reset",
      }),
    ).toBeFalse();
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "no_required",
        registerBy: "SISTEMA-INCOBRABLE",
      }),
    ).toBeFalse();
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "validated",
        registerBy: "SIFCO_IMPORT",
      }),
    ).toBeFalse();
  });

  it("bloquea estados que no son de recuperación (reset, capital, no_required)", () => {
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "reset",
        registerBy: "caren.r@sepresta.com",
      }),
    ).toBeFalse();
    expect(
      isReversibleIncobrablePayment({
        validationStatus: "capital",
        registerBy: "caren.r@sepresta.com",
      }),
    ).toBeFalse();
  });
});
