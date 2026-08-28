export function calcularTotalConvenioCuotas({
  selectedInstallmentIds,
  installments,
  regularInstallmentAmount,
  firstInstallmentAmount,
  lateFee,
}: {
  selectedInstallmentIds: readonly number[];
  installments: readonly { cuota_id: number; numero_cuota: number }[];
  regularInstallmentAmount: number;
  firstInstallmentAmount: number;
  lateFee: number;
}): number {
  const selected = new Set(selectedInstallmentIds);
  const installmentsTotal = installments.reduce((total, installment) => {
    if (!selected.has(installment.cuota_id)) return total;
    return (
      total +
      (installment.numero_cuota === 1
        ? firstInstallmentAmount
        : regularInstallmentAmount)
    );
  }, 0);
  return installmentsTotal + lateFee;
}
