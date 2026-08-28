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

// Estados de crédito sobre los que se permite reversar un pago.
// Incluye INCOBRABLE: aunque el crédito ya esté castigado, si se registró un
// pago por error (p. ej. el pago aún se puede crear sobre un incobrable) debe
// poder reversarse. Los estados de cierre (CANCELADO, PENDIENTE_CANCELACION,
// CAIDO) siguen bloqueados.
export const REVERSIBLE_CREDIT_STATUSES = [
  "ACTIVO",
  "MOROSO",
  "EN_CONVENIO",
  "INCOBRABLE",
] as const;

export function isCreditStatusReversible(status?: string | null) {
  return (
    status != null &&
    (REVERSIBLE_CREDIT_STATUSES as readonly string[]).includes(status)
  );
}

// `registerBy` de filas generadas por el sistema (no son recuperaciones reales):
// cierre de castigo e importaciones. Si una de estas se reversa en un incobrable,
// se corrompe la estructura del castigo (resetea la fila, borra boletas, y si está
// `validated` hasta devuelve capital). Ver crédito 23 / pago 121102 (system_reset,
// validated, abono 6,272.54 → reversarlo duplicaría el capital).
const SYSTEM_REGISTER_BY_PREFIXES = ["sistema", "sifco"];
const SYSTEM_REGISTER_BY_EXACT = ["system_reset"];

/**
 * En un crédito INCOBRABLE solo se permite reversar PAGOS DE RECUPERACIÓN reales:
 * un pago en `pending`/`validated` registrado por un usuario (no por el sistema).
 * Excluye filas estructurales (reset/castigo/SIFCO, abonos directos a capital).
 */
export function isReversibleIncobrablePayment({
  validationStatus,
  registerBy,
}: {
  validationStatus?: string | null;
  registerBy?: string | null;
}): boolean {
  const isRecoveryStatus =
    validationStatus === "pending" || validationStatus === "validated";
  if (!isRecoveryStatus) return false;

  const rb = (registerBy ?? "").trim().toLowerCase();
  if (SYSTEM_REGISTER_BY_EXACT.includes(rb)) return false;
  if (SYSTEM_REGISTER_BY_PREFIXES.some((prefix) => rb.startsWith(prefix))) {
    return false;
  }
  return true;
}

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

  return totalValidated.gte(cuotaAmount);
}

export function getRemainingPaymentPaidStatusAfterReversal(
  installmentRemainsPaid: boolean,
) {
  return installmentRemainsPaid;
}
