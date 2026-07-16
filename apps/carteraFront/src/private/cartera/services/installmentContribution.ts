export type InstallmentContributionSummary = {
  cuota_cerrada: boolean;
  total_aplicado_cuota: string;
  saldo_pendiente: string;
  tiene_abono_parcial: boolean;
};

export const getDisplayedPartialContribution = (
  summary: InstallmentContributionSummary | null,
) => {
  if (
    !summary ||
    summary.cuota_cerrada ||
    !summary.tiene_abono_parcial
  ) {
    return 0;
  }

  const applied = Number(summary.total_aplicado_cuota);
  const pending = Number(summary.saldo_pendiente);
  return Number.isFinite(applied) && applied > 0 && pending > 0 ? applied : 0;
};
