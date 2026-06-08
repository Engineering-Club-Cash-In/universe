export const getCuotaIdForPaymentInsert = (
  cuotaId: number | null | undefined
) => cuotaId ?? null;

export const getRequestedInstallmentFloor = (_requestedInstallment: number) => 1;

export const shouldMarkInstallmentPaymentPaid = ({
  allRemainingZero,
  hasExistingInstallmentPayment,
  installmentAmountApplied,
}: {
  allRemainingZero: boolean;
  hasExistingInstallmentPayment: boolean;
  installmentAmountApplied: number | string;
}) =>
  allRemainingZero &&
  hasExistingInstallmentPayment &&
  Number(installmentAmountApplied) > 0;

export const applyCapitalPaymentAndBuildResponse = async (
  pago: { credito_id: number | null; abono_capital?: number | string | null },
  pagoId: number,
  applyCapitalAbono: (
    creditoId: number,
    abonoCapital: number | string,
    pagoId: number
  ) => Promise<unknown>
) => {
  if (pago.credito_id === null) {
    throw new Error("No se puede aplicar el abono: credito_id es null");
  }

  await applyCapitalAbono(pago.credito_id, pago.abono_capital ?? "0", pagoId);
  console.log("⚠️ El pago es un abono directo a capital");
  return {
    success: true,
    applied: false,
    message:
      "Pago validado como abono a capital , se abonó a inversionistas correctamente",
  };
};
