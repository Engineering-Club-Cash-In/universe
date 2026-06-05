import Big from "big.js";

export const getCuotaIdForPaymentInsert = (
  cuotaId: number | null | undefined
) => cuotaId ?? null;

type BigInput = number | string | Big;

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
  // Ya abonado por los pagos hermanos vivos en cada rubro plano.
  hermanosSeguro: BigInput;
  hermanosGps: BigInput;
  hermanosMembresias: BigInput;
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
 * - El capital absorbe el faltante real restante tras los demás rubros, sin
 *   exceder lo que indica la fila vigente.
 *
 * En una cuota fresca (sin hermanos) es no-op: objetivo − 0 == lo que ya trae
 * la fila, y capital == su saldo de fila.
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

  const interesRestante = new Big(i.filaInteresRestante);
  const ivaRestante = new Big(i.filaIvaRestante);
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
