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

export type FactorPonderadoPorMontoInput = {
  montoAportado: string | Big;
  factor: Big;
};

export function calcularPropiedadesPorMonto(
  inversionistas: Array<Pick<FactorPonderadoPorMontoInput, "montoAportado">>,
): Big[] {
  const totalAportado = inversionistas.reduce(
    (total, inversionista) => total.plus(inversionista.montoAportado),
    new Big(0),
  );

  return inversionistas.map((inversionista) =>
    totalAportado.gt(0) ? new Big(inversionista.montoAportado).div(totalAportado) : new Big(0),
  );
}

export function calcularFactoresPonderadosPorMonto(
  inversionistas: FactorPonderadoPorMontoInput[],
): Big[] {
  return calcularPropiedadesPorMonto(inversionistas).map((ownership, index) =>
    ownership.times(inversionistas[index]?.factor ?? new Big(0)),
  );
}

export function calcularFactorPonderadoPorMonto(
  inversionistas: FactorPonderadoPorMontoInput[],
): Big {
  return calcularFactoresPonderadosPorMonto(inversionistas).reduce(
    (total, factor) => total.plus(factor),
    new Big(0),
  );
}

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

  const factoresParticipacion = inversionistas.map((inv) => {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();
    return isCube
      ? new Big(inv.porcentaje_cash_in ?? 0).div(100)
      : new Big(inv.porcentaje_participacion_inversionista ?? 0).div(100);
  });
  const ownerships = calcularPropiedadesPorMonto(
    inversionistas.map((inv) => {
      return {
        montoAportado: new Big(inv.monto_aportado ?? 0),
      };
    }),
  );

  const result: InvSplitRow[] = [];

  for (const [index, inv] of inversionistas.entries()) {

    let abonoInteresInv: Big;
    let abonoIvaInv: Big;

    if (factorInteresPorInv) {
      const f = factorInteresPorInv.get(inv.inversionista_id) ?? new Big(0);
      abonoInteresInv = pagoAbonoInteres.times(f);
      abonoIvaInv = pagoAbonoIva.times(f);
    } else {
      const factor = factoresParticipacion[index] ?? new Big(0);
      const ownership = ownerships[index] ?? new Big(0);
      abonoInteresInv = pagoAbonoInteres.times(factor).times(ownership);
      abonoIvaInv = pagoAbonoIva.times(factor).times(ownership);
    }

    result.push({
      inversionista_id: inv.inversionista_id,
      abono_interes: abonoInteresInv,
      abono_iva_12: abonoIvaInv,
    });
  }

  return result;
}
