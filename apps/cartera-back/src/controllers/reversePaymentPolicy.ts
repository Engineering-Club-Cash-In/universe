import Big from "big.js";

type SameInstallmentPayment = {
  pago_id?: number | string | null;
  monto_aplicado?: string | number | null;
  monto_boleta?: string | number | null;
  validationStatus?: string | null;
  paymentFalse?: boolean | null;
  pagado?: boolean | null;
};

type RemainingPayment = {
  monto_aplicado?: string | number | null;
  validationStatus?: string | null;
  paymentFalse?: boolean | null;
};

const toBig = (value?: string | number | null) => new Big(value ?? 0);

export function shouldRemoveSameInstallmentPaymentOnReverse(
  payment: SameInstallmentPayment,
) {
  return (
    toBig(payment.monto_aplicado).eq(0) &&
    toBig(payment.monto_boleta).eq(0) &&
    payment.validationStatus === "no_required" &&
    payment.pagado === false &&
    payment.paymentFalse !== true
  );
}

export function shouldInstallmentRemainPaidAfterReversal({
  cuota,
  remainingPayments,
}: {
  cuota?: string | number | null;
  remainingPayments: RemainingPayment[];
}) {
  const cuotaAmount = toBig(cuota);
  if (cuotaAmount.lte(0)) return false;

  const totalValidated = remainingPayments.reduce((total, payment) => {
    if (payment.validationStatus !== "validated" || payment.paymentFalse === true) {
      return total;
    }

    return total.plus(toBig(payment.monto_aplicado));
  }, new Big(0));

  return totalValidated.gte(cuotaAmount.minus(0.01));
}

export function getPaymentIdsForInvestorReverse(
  selectedPagoId: number,
  _sameInstallmentPagoIds: number[],
) {
  return [selectedPagoId];
}
