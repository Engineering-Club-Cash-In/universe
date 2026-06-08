import Big from "big.js";

type BigInput = number | string | Big;

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

export const shouldApplyStaleZeroRestanteAdjustment = ({
  hasExistingPayment,
  isFirstProcessedInstallment,
  isExactSingleInstallmentPayment,
  hasValidatedPayments,
  hasLastPartialPaymentWithRemaining,
  allRemainingZero,
  missingAgainstInstallment,
  availableRemaining,
}: {
  hasExistingPayment: boolean;
  isFirstProcessedInstallment: boolean;
  isExactSingleInstallmentPayment: boolean;
  hasValidatedPayments: boolean;
  hasLastPartialPaymentWithRemaining: boolean;
  allRemainingZero: boolean;
  missingAgainstInstallment: BigInput;
  availableRemaining: BigInput;
}) =>
  hasExistingPayment &&
  isFirstProcessedInstallment &&
  isExactSingleInstallmentPayment &&
  !hasValidatedPayments &&
  !hasLastPartialPaymentWithRemaining &&
  allRemainingZero &&
  new Big(missingAgainstInstallment).gt(0) &&
  new Big(availableRemaining).gte(missingAgainstInstallment);

export const getSpecialPaymentCuotaId = ({
  requestedInstallment,
  pendingInstallments,
}: {
  requestedInstallment: number;
  pendingInstallments: { numeroCuota: number; cuotaId: number }[];
}) =>
  pendingInstallments.find(
    (installment) => installment.numeroCuota === requestedInstallment
  )?.cuotaId ??
  pendingInstallments[0]?.cuotaId ??
  0;

export const getSpecialPaymentInstallmentFields = () => ({
  montoAplicado: 0,
  pagado: true,
});

export type SaldoCuotaInput = {
  /** Monto total de la cuota (credito.cuota). */
  montoCuota: BigInput;
  /** Σ monto_aplicado de los pagos hermanos vivos (validated/pending). */
  aplicadoPrevioCuota: BigInput;
  // Saldos que indica la fila de pago vigente (pueden estar desincronizados).
  filaInteresRestante: BigInput;
  filaIvaRestante: BigInput;
  filaSeguroRestante: BigInput;
  filaGpsRestante: BigInput;
  filaMembresiasRestante: BigInput;
  filaCapitalRestante: BigInput;
  // Objetivo por cuota de cada rubro plano (del crédito).
  objetivoSeguro: BigInput;
  objetivoGps: BigInput;
  objetivoMembresias: BigInput;
  // Ya abonado por los pagos hermanos vivos en cada rubro plano. Para
  // seguro/GPS/membresías son TODOS los hermanos (se netea contra el objetivo
  // plano del crédito).
  hermanosSeguro: BigInput;
  hermanosGps: BigInput;
  hermanosMembresias: BigInput;
  // Interés/IVA ya abonado por hermanos DISTINTOS a la fila vigente. El interés
  // por cuota no tiene un objetivo plano confiable (el real difiere del nominal
  // `credito.cuota_interes`), así que no se puede netear contra el crédito sin
  // sub-cobrar en cuotas frescas. En su lugar se netea la fila menos lo que
  // aplicaron los OTROS hermanos: la fila ya refleja su propia aplicación, y lo
  // de los demás hermanos es lo que la fila stale podría re-aplicar.
  hermanosInteres: BigInput;
  hermanosIva: BigInput;
};

export type SaldoCuotaNeto = {
  saldoRealCuota: Big;
  interesRestante: Big;
  ivaRestante: Big;
  seguroRestante: Big;
  gpsRestante: Big;
  membresiasRestante: Big;
  capitalRestante: Big;
};

/**
 * Saldo NETO de una cuota para distribuir un pago, robusto ante `*_restante`
 * desincronizados entre pagos hermanos.
 *
 * - Faltante real de la cuota = monto_cuota − Σ monto_aplicado hermanos.
 * - Rubros planos (seguro/GPS/membresías) = mín(saldo de la fila, objetivo −
 *   ya abonado por hermanos), nunca negativo. Así un rubro ya cubierto por un
 *   pago previo no se vuelve a aplicar aunque la fila vigente lo muestre lleno.
 * - Interés/IVA = máx(0, saldo de la fila − ya abonado por hermanos DISTINTOS a
 *   la fila vigente). No hay objetivo plano confiable para estos rubros, así
 *   que se restan los abonos de los otros hermanos (lo que una fila stale
 *   re-aplicaría) sin tocar lo que la propia fila ya refleja.
 * - El capital absorbe el faltante real restante tras los demás rubros, sin
 *   exceder lo que indica la fila vigente.
 *
 * En una cuota fresca (sin hermanos) es no-op: objetivo − 0 == lo que ya trae
 * la fila, interés/IVA − 0 == la fila, y capital == su saldo de fila.
 */
export const calcularSaldoNetoCuota = (
  i: SaldoCuotaInput
): SaldoCuotaNeto => {
  const cero = new Big(0);
  const noNeg = (b: Big) => (b.gt(cero) ? b : cero);
  const min = (a: Big, b: Big) => (a.lt(b) ? a : b);
  const saldoRubro = (saldoFila: Big, falta: Big) =>
    noNeg(min(saldoFila, falta));

  const montoCuota = new Big(i.montoCuota);
  const saldoRealCuota = noNeg(montoCuota.minus(i.aplicadoPrevioCuota));

  // Interés/IVA: la fila ya refleja su propia aplicación; restamos lo que
  // aplicaron los OTROS hermanos para no re-aplicarlo si la fila quedó stale.
  const interesRestante = noNeg(
    new Big(i.filaInteresRestante).minus(i.hermanosInteres)
  );
  const ivaRestante = noNeg(new Big(i.filaIvaRestante).minus(i.hermanosIva));
  const seguroRestante = saldoRubro(
    new Big(i.filaSeguroRestante),
    new Big(i.objetivoSeguro).minus(i.hermanosSeguro)
  );
  const gpsRestante = saldoRubro(
    new Big(i.filaGpsRestante),
    new Big(i.objetivoGps).minus(i.hermanosGps)
  );
  const membresiasRestante = saldoRubro(
    new Big(i.filaMembresiasRestante),
    new Big(i.objetivoMembresias).minus(i.hermanosMembresias)
  );
  const rubrosNoCapital = interesRestante
    .plus(ivaRestante)
    .plus(seguroRestante)
    .plus(gpsRestante)
    .plus(membresiasRestante);
  const capitalRestante = saldoRubro(
    new Big(i.filaCapitalRestante),
    saldoRealCuota.minus(rubrosNoCapital)
  );

  return {
    saldoRealCuota,
    interesRestante,
    ivaRestante,
    seguroRestante,
    gpsRestante,
    membresiasRestante,
    capitalRestante,
  };
};

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
