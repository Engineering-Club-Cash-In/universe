import { describe, expect, it } from "bun:test";
import {
  buildInstallmentRemainderReplication,
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

describe("buildInstallmentRemainderReplication", () => {
  it("arma el saldo a replicar en TODAS las filas vivas de la cuota", () => {
    // Los restantes restaurados son "restante de la fila + su abono": es el
    // saldo que la cuota tenía ANTES del pago que se revierte, y ese saldo vale
    // para todas sus filas porque insertPayment lo replica en todas.
    const replica = buildInstallmentRemainderReplication({
      cuotaId: 55,
      creditoId: 9234,
      restantes: {
        capital: "1998.48",
        interes: "80",
        iva: "9.6",
        seguro: "245",
        gps: "0",
        membresias: "743.24",
      },
      aplicadoALaCuota: "2000",
      filaAnulada: false,
    });

    expect(replica).toEqual({
      cuotaId: 55,
      creditoId: 9234,
      payload: {
        capital_restante: "1998.48",
        interes_restante: "80",
        iva_12_restante: "9.6",
        seguro_restante: "245",
        gps_restante: "0",
        membresias: "743.24",
      },
    });
  });

  it("no replica nada cuando el pago no cuelga de ninguna cuota", () => {
    // Un abono directo a capital / fila suelta no tiene cuota: sin `cuota_id` el
    // UPDATE no tendría con qué acotarse y pisaría filas de otras cuotas.
    expect(
      buildInstallmentRemainderReplication({
        cuotaId: null,
        creditoId: 9234,
        restantes: {
          capital: "10",
          interes: "0",
          iva: "0",
          seguro: "0",
          gps: "0",
          membresias: "0",
        },
        aplicadoALaCuota: "10",
        filaAnulada: false,
      }),
    ).toBeNull();
  });

  it("tampoco replica si falta el crédito (el filtro quedaría abierto a otros créditos)", () => {
    expect(
      buildInstallmentRemainderReplication({
        cuotaId: 55,
        creditoId: null,
        restantes: {
          capital: "10",
          interes: "0",
          iva: "0",
          seguro: "0",
          gps: "0",
          membresias: "0",
        },
        aplicadoALaCuota: "10",
        filaAnulada: false,
      }),
    ).toBeNull();
  });

  it("no replica cuando la fila revertida no le aportó nada a la cuota (SOLO MORA / SOLO OTROS)", () => {
    // `insertarPago` (registerPayment.ts) inserta los pagos de SOLO MORA / SOLO
    // OTROS / SOLO CONVENIO con los seis abonos en cero y los engancha a la
    // primera cuota PENDIENTE vía `getSpecialPaymentCuotaId` — no a una cuota
    // que ellos hayan pagado. Si se replicara igual, el saldo restaurado
    // (restante + abono(0) = restante original) pisaría con CERO todas las
    // filas vivas de esa cuota abierta con la que el pago no tiene relación.
    expect(
      buildInstallmentRemainderReplication({
        cuotaId: 55,
        creditoId: 9234,
        restantes: {
          capital: "0",
          interes: "0",
          iva: "0",
          seguro: "0",
          gps: "0",
          membresias: "0",
        },
        aplicadoALaCuota: "0",
        filaAnulada: false,
      }),
    ).toBeNull();
  });

  it("no replica cuando la fila que se revierte YA ESTÁ ANULADA (paymentFalse)", () => {
    // `falsePayment` (controllers/payments.ts) anula con sólo
    // `set({ pagado: false, paymentFalse: true })`: CONSERVA los `abono_*`, así
    // que `aplicadoALaCuota` no es cero y la guarda de arriba no la atrapa. Pero
    // la fila anulada está fuera de la contabilidad de la cuota (el saldo
    // replicado se estampa con `paymentFalse = false`), así que devolverle sus
    // abonos al saldo es DOBLE CONTEO.
    //
    // Cuota de Q1,000: el pago A cobra 400 → se anula → el pago B cobra 600 y
    // salda la cuota. Reversar A con réplica dejaría el saldo en Q1,000 (400 de
    // la fila anulada + los 600 que el saldo vivo ya no debe) y el próximo pago
    // le re-cobraría Q600 al cliente que no debe nada.
    expect(
      buildInstallmentRemainderReplication({
        cuotaId: 55,
        creditoId: 9234,
        restantes: {
          capital: "400",
          interes: "0",
          iva: "0",
          seguro: "0",
          gps: "0",
          membresias: "0",
        },
        aplicadoALaCuota: "400",
        filaAnulada: true,
      }),
    ).toBeNull();
  });
});
