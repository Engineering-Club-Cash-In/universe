import Big from "big.js";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

export type InvSplitInput = {
  inversionista_id: number;
  nombre: string;
  porcentaje_participacion_inversionista: string | number; // %
  porcentaje_cash_in: string | number;                     // %
  monto_aportado: string | number;
};

export type InvSplitRow = {
  inversionista_id: number;
  abono_interes: Big;
  abono_iva_12: Big;
};

/**
 * Calcula la distribución del interés e IVA del pago por inversionista.
 *
 * Lógica extraída de `insertPagosCreditoInversionistasV2` (~payments.ts:1149-1204):
 *   - Con compra de cartera pendiente (factorInteresPorInv != null): usa el factor prorrateado.
 *   - Sin compra: fórmula regular: pct_propio × porcentajeGeneral
 *       donde pct_propio = porcentaje_cash_in (CUBE) o porcentaje_participacion_inversionista (demás).
 *       porcentajeGeneral = monto_aportado / Σmonto_aportado.
 *
 * Incluye TODOS los inversionistas (incl. self-billing / emite_factura=true).
 * NO calcula residuo — eso es Task 2.
 * Devuelve abono_interes y abono_iva_12 como Big sin redondear; el caller redondea al persistir.
 */
export function calcularSplitInteresPci(args: {
  inversionistas: InvSplitInput[];
  pagoAbonoInteres: Big;
  pagoAbonoIva: Big;
  factorInteresPorInv?: Map<number, Big> | null; // compra de cartera; null = regular
}): InvSplitRow[] {
  const { inversionistas, pagoAbonoInteres, pagoAbonoIva, factorInteresPorInv } = args;

  // Suma de todos los monto_aportado (denominador del porcentajeGeneral)
  const sumMontosAportados = inversionistas.reduce(
    (acc, inv) => acc.plus(new Big(inv.monto_aportado ?? 0)),
    new Big(0)
  );

  const result: InvSplitRow[] = [];

  for (const inv of inversionistas) {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

    const montoBase = new Big(inv.monto_aportado ?? 0);

    // Porcentaje general: base_calculo / SUM(monto_aportado)
    const porcentajeGeneral = sumMontosAportados.gt(0)
      ? montoBase.div(sumMontosAportados)
      : new Big(0);

    // Porcentaje de participación según tipo (dividir entre 100 porque se guarda como %)
    const porcentajeParticipacion = isCube
      ? new Big(inv.porcentaje_cash_in ?? 0).div(100)
      : new Big(inv.porcentaje_participacion_inversionista ?? 0).div(100);

    let abonoInteresInv: Big;
    let abonoIvaInv: Big;

    if (factorInteresPorInv) {
      const f = factorInteresPorInv.get(inv.inversionista_id) ?? new Big(0);
      abonoInteresInv = pagoAbonoInteres.times(f);
      abonoIvaInv = pagoAbonoIva.times(f);
    } else {
      abonoInteresInv = pagoAbonoInteres.times(porcentajeParticipacion).times(porcentajeGeneral);
      abonoIvaInv = pagoAbonoIva.times(porcentajeParticipacion).times(porcentajeGeneral);
    }

    result.push({
      inversionista_id: inv.inversionista_id,
      abono_interes: abonoInteresInv,
      abono_iva_12: abonoIvaInv,
    });
  }

  return result;
}

/**
 * Aplica el residuo de CUBE al split de interés/IVA.
 *
 * residuo_int = pagoAbonoInteres − Σ(split.abono_interes)
 * residuo_iva = pagoAbonoIva    − Σ(split.abono_iva_12)
 *
 * Si residuo ≤ 0.01 → no toca nada (≈ 0, diferencia de redondeo irrelevante).
 * Si CUBE ya está en el split → le suma el residuo.
 * Si CUBE no está → agrega una fila nueva con el residuo.
 * Nunca produce residuo negativo (clamp a 0).
 */
export function aplicarResiduoCube(args: {
  split: InvSplitRow[];
  pagoAbonoInteres: Big;
  pagoAbonoIva: Big;
  cubeInversionistaId: number;
}): InvSplitRow[] {
  const { split, pagoAbonoInteres, pagoAbonoIva, cubeInversionistaId } = args;

  const EPSILON = new Big("0.01");

  const sumaInt = split.reduce((acc, r) => acc.plus(r.abono_interes), new Big(0));
  const sumaIva = split.reduce((acc, r) => acc.plus(r.abono_iva_12), new Big(0));

  const rawResiduoInt = pagoAbonoInteres.minus(sumaInt);
  const rawResiduoIva = pagoAbonoIva.minus(sumaIva);

  // Clamp negatives to 0
  const residuoInt = rawResiduoInt.lt(new Big(0)) ? new Big(0) : rawResiduoInt;
  const residuoIva = rawResiduoIva.lt(new Big(0)) ? new Big(0) : rawResiduoIva;

  // If residuo ≈ 0 → nothing to do
  if (residuoInt.lte(EPSILON) && residuoIva.lte(EPSILON)) {
    return split;
  }

  // Clone the array so we don't mutate the input
  const result: InvSplitRow[] = split.map(r => ({ ...r }));

  const cubeIdx = result.findIndex(r => r.inversionista_id === cubeInversionistaId);

  if (cubeIdx >= 0) {
    // CUBE already in split → add residuo
    result[cubeIdx] = {
      ...result[cubeIdx],
      abono_interes: result[cubeIdx].abono_interes.plus(residuoInt),
      abono_iva_12: result[cubeIdx].abono_iva_12.plus(residuoIva),
    };
  } else {
    // CUBE not present → push a new row
    result.push({
      inversionista_id: cubeInversionistaId,
      abono_interes: residuoInt,
      abono_iva_12: residuoIva,
    });
  }

  return result;
}
