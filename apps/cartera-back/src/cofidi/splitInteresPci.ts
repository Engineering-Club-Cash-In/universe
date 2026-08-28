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
 * Los inversionistas externos se redondean a centavos y CUBE recibe el
 * residuo exacto del pago. La tabla destino es numeric(18,2), por lo que
 * calcular el residuo antes de persistir evita brechas por redondeo fila a fila.
 */
export function calcularSplitInteresPci(args: {
  inversionistas: InvSplitInput[];
  pagoAbonoInteres: Big;
  pagoAbonoIva: Big;
  factorInteresPorInv?: Map<number, Big> | null; // compra de cartera; null = regular
}): InvSplitRow[] {
  const { inversionistas, pagoAbonoInteres, pagoAbonoIva, factorInteresPorInv } = args;

  const cubeIndex = inversionistas.findIndex(
    (inv) => inv.nombre.trim().toLowerCase() === "cube investments s.a.",
  );
  const factoresParticipacion = inversionistas.map((inv) => {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.";
    return isCube
      ? new Big(inv.porcentaje_cash_in ?? 0).div(100)
      : new Big(inv.porcentaje_participacion_inversionista ?? 0).div(100);
  });
  const ownerships = calcularPropiedadesPorMonto(
    inversionistas.map((inv) => ({
      montoAportado: new Big(inv.monto_aportado ?? 0),
    })),
  );

  const result: InvSplitRow[] = inversionistas.map((inv, index) => {
    if (index === cubeIndex) {
      return {
        inversionista_id: inv.inversionista_id,
        abono_interes: new Big(0),
        abono_iva_12: new Big(0),
      };
    }

    const factor = factorInteresPorInv
      ? (factorInteresPorInv.get(inv.inversionista_id) ?? new Big(0))
      : (factoresParticipacion[index] ?? new Big(0)).times(
          ownerships[index] ?? new Big(0),
        );
    return {
      inversionista_id: inv.inversionista_id,
      abono_interes: pagoAbonoInteres.times(factor).round(2),
      abono_iva_12: pagoAbonoIva.times(factor).round(2),
    };
  });

  if (cubeIndex >= 0) {
    const interesExterno = result.reduce(
      (total, row, index) =>
        index === cubeIndex ? total : total.plus(row.abono_interes),
      new Big(0),
    );
    const ivaExterno = result.reduce(
      (total, row, index) =>
        index === cubeIndex ? total : total.plus(row.abono_iva_12),
      new Big(0),
    );
    result[cubeIndex] = {
      inversionista_id: inversionistas[cubeIndex]!.inversionista_id,
      abono_interes: pagoAbonoInteres.round(2).minus(interesExterno),
      abono_iva_12: pagoAbonoIva.round(2).minus(ivaExterno),
    };
  }

  return result;
}
