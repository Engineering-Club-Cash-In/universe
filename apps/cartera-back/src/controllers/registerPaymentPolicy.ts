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
  /**
   * Σ de los rubros de cuota aplicados por los pagos hermanos vivos
   * (validated/pending): capital + interés + IVA + seguro + GPS + membresías.
   * Excluye mora/otros y abonos directos a capital (no son parte de la cuota).
   * Ver `sumarAplicadoACuota`.
   */
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

/** Fila de pago hermano con sus rubros de cuota (los `abono_*`). */
export type RubrosCuotaRow = {
  abono_capital?: BigInput | null;
  abono_interes?: BigInput | null;
  abono_iva_12?: BigInput | null;
  abono_seguro?: BigInput | null;
  abono_gps?: BigInput | null;
  membresias_pago?: BigInput | null;
};

/**
 * Σ de lo que los pagos hermanos aplicaron a la CUOTA contractual
 * (`credito.cuota`): capital + interés + IVA + seguro + GPS + membresías.
 *
 * A propósito NO usa `monto_aplicado` ni suma `mora`/`otros`. Esos buckets no
 * son parte de la cuota:
 *  - Las filas de sólo mora/otros traen TODOS los `abono_*` en 0, así que
 *    aportan 0 (su `monto_aplicado` legacy = mora+otros, que no es cuota).
 *  - Los abonos directos a capital viven en `validationStatus = "capital"` y
 *    ni siquiera entran al set de hermanos vivos.
 *
 * Para una fila de cuota normal `monto_aplicado` == esta suma, así que en datos
 * limpios es equivalente; sólo deja de inflar el faltante con mora/otros, que
 * antes colapsaba `saldoRealCuota` a 0 y disparaba un rechazo falso de
 * "sobre-aplicación".
 */
export const sumarAplicadoACuota = (rows: RubrosCuotaRow[]): Big =>
  rows.reduce(
    (acc, r) =>
      acc
        .plus(new Big(r.abono_capital ?? 0))
        .plus(new Big(r.abono_interes ?? 0))
        .plus(new Big(r.abono_iva_12 ?? 0))
        .plus(new Big(r.abono_seguro ?? 0))
        .plus(new Big(r.abono_gps ?? 0))
        .plus(new Big(r.membresias_pago ?? 0)),
    new Big(0)
  );

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
 * - Faltante real de la cuota = monto_cuota − Σ rubros de cuota de hermanos
 *   (capital+interés+IVA+seguro+GPS+membresías; ver `sumarAplicadoACuota`).
 *   NO se cuenta mora/otros ni abonos directos a capital: no son cuota.
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

// Tolerancia de un centavo por redondeos al comparar el capital contra cero.
export const INCOBRABLE_CAPITAL_TOLERANCE = 0.01;

/**
 * Regla de cierre de cuota para créditos en estado INCOBRABLE.
 *
 * Al castigar un crédito queda una sola cuota que representa el capital
 * incobrable y se va recuperando con pagos parciales. NO se puede usar la suma
 * de `monto_aplicado` para decidir si la cuota quedó pagada: filas
 * estructurales (reset / `system_reset`, `SISTEMA-INCOBRABLE`) contaminan esa
 * suma y cerrarían la cuota sin recuperación real (ver crédito 23 / SIFCO
 * 01010214119670, donde una fila `system_reset` de 6,272.54 marcaba la cuota
 * como pagada mientras el capital seguía en 7,744.11).
 *
 * Criterio fiel: la cuota se marca pagada si y solo si el capital del crédito
 * llega a 0 (≤ tolerancia) después de aplicar el `abono_capital` de este pago.
 *
 * @returns `true`/`false` cuando el crédito es INCOBRABLE; `null` cuando la
 *   regla NO aplica (cualquier otro estado), para que el caller conserve su
 *   lógica normal basada en la suma de `monto_aplicado`.
 */
export const shouldIncobrableInstallmentBePaid = ({
  statusCredit,
  capital,
  abonoCapital,
}: {
  statusCredit?: string | null;
  capital?: string | number | null;
  abonoCapital?: string | number | null;
}): boolean | null => {
  if (statusCredit !== "INCOBRABLE") return null;

  const capitalDespuesDelPago = new Big(capital ?? 0).minus(new Big(abonoCapital ?? 0));
  return capitalDespuesDelPago.lte(INCOBRABLE_CAPITAL_TOLERANCE);
};

/**
 * Recalcula capital / cuota_interes / iva_12 / deudatotal de un crédito tras un
 * cambio de capital, aplicando dos invariantes:
 *  - El capital nunca queda NEGATIVO (una sobre-recuperación se clampa a 0).
 *  - Un crédito INCOBRABLE NO devenga interés: cuota_interes = iva_12 = 0. El
 *    castigo preserva `porcentaje_interes`, así que recalcular interés sobre él
 *    reviviría deuda fantasma en un castigado (que es capital-only).
 *
 * `newCapital` es el capital YA calculado por el caller (capital ± abono).
 */
export const recomputeCreditAfterCapital = ({
  statusCredit,
  newCapital,
  porcentajeInteres,
  seguro = 0,
  gps = 0,
  membresias = 0,
}: {
  statusCredit?: string | null;
  newCapital: string | number | Big | null;
  porcentajeInteres?: string | number | null;
  seguro?: string | number | null;
  gps?: string | number | null;
  membresias?: string | number | null;
}) => {
  let capital = new Big(newCapital ?? 0);
  if (capital.lt(0)) capital = new Big(0);

  const cuotaInteres =
    statusCredit === "INCOBRABLE"
      ? new Big(0)
      : capital.times(new Big(porcentajeInteres ?? 0).div(100)).round(2);
  const iva = cuotaInteres.times(0.12).round(2);
  const deudaTotal = capital
    .plus(cuotaInteres)
    .plus(iva)
    .plus(new Big(seguro ?? 0))
    .plus(new Big(gps ?? 0))
    .plus(new Big(membresias ?? 0))
    .round(2);

  return { capital, cuotaInteres, iva, deudaTotal };
};
