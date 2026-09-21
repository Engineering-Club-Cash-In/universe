import Big from "big.js";
import { distribuirConResiduoCube } from "../cofidi/splitInteresPci";

const CUBE_ID = 86;
const ELIGIBLE_CREDIT_STATUSES = new Set(["ACTIVO", "MOROSO", "EN_CONVENIO"]);

export type ProjectionSourceRow = {
  inversionista_id: number;
  nombre: string;
  tipo_reinv_efectivo: string;
  monto_reinversion: string | null;
  descuenta_impuestos: boolean;
  emite_factura: boolean;
  cuota: string;
  interes_inversionista: string;
  interes_cube: string;
  iva_inversionista: string;
  iva_cube: string;
  cargos: string;
  es_mayor_participacion: boolean;
  monto_aportado: string;
  status_credito?: string;
  fecha_inicio_participacion?: string;
  fecha_corte?: string;
  credito_id?: number;
  numero_cuota?: number;
  fecha_vencimiento?: string;
  en_periodo?: boolean;
  capital_credito?: string;
  cuota_credito?: string;
  porcentaje_interes?: string;
  porcentaje_inversionista?: string;
  porcentaje_cube?: string;
  monto_pendiente?: string;
  capital_pagado_pendiente_liquidar?: string;
  monto_compras_mes_anterior?: string;
  monto_compras_mes_actual?: string;
  cube_nombre?: string;
  cube_tipo_reinv_efectivo?: string;
  cube_monto_reinversion?: string | null;
  cube_descuenta_impuestos?: boolean;
  cube_emite_factura?: boolean;
  status_posicion?: string;
};

type ProjectedInvestor = {
  inversionista_id: number;
  nombre: string;
  reinversion_capital: string;
  reinversion_interes: string;
  reinversion_total: string;
  cash_capital: string;
  cash_interes: string;
  cash_total: string;
  interes_bruto: string;
  iva: string;
  isr: string;
  total: string;
};

type Accumulator = {
  inversionista_id: number;
  nombre: string;
  montoReinversion: Big;
  reinversionCapital: Big;
  reinversionInteres: Big;
  cashCapital: Big;
  cashInteres: Big;
  grossInterest: Big;
  iva: Big;
  isr: Big;
  variable: Big;
  excedente: Big;
};

const zero = () => new Big(0);
const min = (left: Big, right: Big) => (left.lt(right) ? left : right);

function proportionalFactor(start: string | undefined, due: string | undefined): Big {
  if (!start || !due) return new Big(1);
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [dueYear, dueMonth] = due.split("-").map(Number);
  const previousMonth = dueMonth === 1 ? 12 : dueMonth - 1;
  const previousYear = dueMonth === 1 ? dueYear - 1 : dueYear;
  if (
    startYear !== previousYear ||
    startMonth !== previousMonth ||
    startDay === 1
  ) {
    return new Big(1);
  }
  const daysInMonth = new Date(Date.UTC(startYear, startMonth, 0)).getUTCDate();
  return new Big(Math.max(1, daysInMonth - startDay)).div(daysInMonth);
}

const getPaymentKey = (row: ProjectionSourceRow) => {
  if (row.credito_id === undefined) return null;
  if (row.numero_cuota !== undefined) {
    return `${row.credito_id}:cuota:${row.numero_cuota}`;
  }
  return row.fecha_vencimiento
    ? `${row.credito_id}:fecha:${row.fecha_vencimiento}`
    : null;
};

export function buildProjectedInvestorFlow(rows: ProjectionSourceRow[]): {
  porInversionista: ProjectedInvestor[];
  totales: {
    reinversion_total: string;
    cash_total: string;
    interes_bruto: string;
    iva: string;
    isr: string;
    total: string;
    externos: {
      reinversion_total: string;
      cash_total: string;
      total: string;
    };
    cube: {
      reinversion_total: string;
      cash_total: string;
      total: string;
    };
  };
} {
  const byInvestor = new Map<number, Accumulator>();
  const remainingByPosition = new Map<string, Big>();

  const orderedRows = [...rows].sort((left, right) =>
    (left.fecha_vencimiento ?? "").localeCompare(right.fecha_vencimiento ?? ""),
  );
  const rowsByPayment = new Map<string, ProjectionSourceRow[]>();
  for (const row of orderedRows) {
    const key = getPaymentKey(row);
    if (!key) continue;
    rowsByPayment.set(key, [...(rowsByPayment.get(key) ?? []), row]);
  }
  const chargeOwnerByPayment = new Map<string, number>();
  for (const [key, paymentRows] of rowsByPayment) {
    const eligibleRows = paymentRows.filter(
      (row) =>
        (!row.status_credito || ELIGIBLE_CREDIT_STATUSES.has(row.status_credito)) &&
        row.status_posicion !== "cancelado" &&
        (!row.fecha_inicio_participacion ||
          !row.fecha_corte ||
          row.fecha_inicio_participacion <= row.fecha_corte),
    );
    if (eligibleRows.length === 0) continue;
    const purchasesByInvestor = eligibleRows.map((row) =>
      row.inversionista_id === CUBE_ID
        ? zero()
        : new Big(row.monto_pendiente ?? 0).plus(
            row.monto_compras_mes_actual ?? 0,
          ),
    );
    const totalPurchases = purchasesByInvestor.reduce(
      (total, amount) => total.plus(amount),
      zero(),
    );
    const comparisonAmounts = eligibleRows.map((row, index) =>
      totalPurchases.gt(0)
        ? row.inversionista_id === CUBE_ID
          ? new Big(row.monto_aportado ?? 0).plus(totalPurchases)
          : new Big(row.monto_aportado ?? 0).minus(purchasesByInvestor[index])
        : new Big(row.cuota),
    );
    const ownerIndex = comparisonAmounts.reduce(
      (largest, amount, index) =>
        amount.gt(comparisonAmounts[largest]) ? index : largest,
      0,
    );
    chargeOwnerByPayment.set(key, eligibleRows[ownerIndex].inversionista_id);
  }
  const allocationsByPayment = new Map<
    string,
    Map<number, { interest: Big; iva: Big }>
  >();
  const virtualCubeApplied = new Set<string>();
  const virtualCubePayments = new Set<string>();

  const getPaymentAllocations = (
    key: string,
  ): Map<number, { interest: Big; iva: Big }> | null => {
    const cached = allocationsByPayment.get(key);
    if (cached) return cached;
    const paymentRows = rowsByPayment.get(key) ?? [];
    const exactRows = paymentRows.flatMap((paymentRow) => {
      if (
        (paymentRow.status_credito &&
          !ELIGIBLE_CREDIT_STATUSES.has(paymentRow.status_credito)) ||
        (paymentRow.fecha_inicio_participacion &&
          paymentRow.fecha_corte &&
          paymentRow.fecha_inicio_participacion > paymentRow.fecha_corte) ||
        paymentRow.capital_credito === undefined ||
        paymentRow.cuota_credito === undefined ||
        paymentRow.porcentaje_interes === undefined ||
        paymentRow.porcentaje_inversionista === undefined ||
        paymentRow.porcentaje_cube === undefined
      ) {
        return [];
      }
      const positionKey = `${paymentRow.credito_id}:${paymentRow.inversionista_id}`;
      const initialPosition = new Big(paymentRow.monto_aportado)
        .minus(paymentRow.monto_pendiente ?? 0)
        .minus(paymentRow.capital_pagado_pendiente_liquidar ?? 0);
      const remaining =
        remainingByPosition.get(positionKey) ??
        (initialPosition.lt(0) ? zero() : initialPosition);
      const currentPurchases = min(
        new Big(paymentRow.monto_compras_mes_actual ?? 0),
        remaining,
      );
      const eligible = remaining.minus(currentPurchases);
      const rate = new Big(paymentRow.porcentaje_interes);
      const investorRate = new Big(paymentRow.porcentaje_inversionista).div(100);
      const cubeRate = new Big(paymentRow.porcentaje_cube).div(100);
      const totalExact = remaining
        .times(rate)
        .div(100)
        .times(investorRate.plus(cubeRate));
      const factor =
        paymentRow.inversionista_id === CUBE_ID
          ? new Big(1)
          : proportionalFactor(
              paymentRow.fecha_inicio_participacion,
              paymentRow.fecha_vencimiento,
            );
      const recentPurchases = min(
        new Big(paymentRow.monto_compras_mes_anterior ?? 0),
        eligible,
      );
      const previousCapital = eligible.minus(recentPurchases);
      const investorExact =
        paymentRow.inversionista_id === CUBE_ID
          ? zero()
          : recentPurchases.gt(0) && previousCapital.gt(0)
            ? previousCapital
                .times(rate)
                .div(100)
                .times(investorRate)
                .plus(
                  recentPurchases
                    .times(rate)
                    .div(100)
                    .times(investorRate)
                    .times(factor),
                )
            : eligible.times(rate).div(100).times(investorRate).times(factor);
      return [{ row: paymentRow, totalExact, investorExact }];
    });
    if (exactRows.length === 0) return null;

    const totalInterest = exactRows.reduce(
      (sum, item) => sum.plus(item.totalExact),
      zero(),
    );
    if (totalInterest.lte(0)) return null;
    const cubeRowIndex = exactRows.findIndex(
      (item) => item.row.inversionista_id === CUBE_ID,
    );
    const allocationRows =
      cubeRowIndex >= 0
        ? exactRows
        : [
            ...exactRows,
            {
              row: { ...exactRows[0]!.row, inversionista_id: CUBE_ID },
              totalExact: zero(),
              investorExact: zero(),
            },
          ];
    if (cubeRowIndex < 0) virtualCubePayments.add(key);
    const cubeIndex = cubeRowIndex >= 0 ? cubeRowIndex : allocationRows.length - 1;
    const factors = allocationRows.map((item, index) =>
      index === cubeIndex ? zero() : item.investorExact.div(totalInterest),
    );
    const interests = distribuirConResiduoCube({
      total: totalInterest,
      factores: factors,
      cubeIndex,
    });
    const ivas = distribuirConResiduoCube({
      total: totalInterest.times("0.12"),
      factores: factors,
      cubeIndex,
    });
    const allocations = new Map<number, { interest: Big; iva: Big }>();
    allocationRows.forEach((item, index) => {
      allocations.set(item.row.inversionista_id, {
        interest: interests[index] ?? zero(),
        iva: ivas[index] ?? zero(),
      });
    });
    allocationsByPayment.set(key, allocations);
    return allocations;
  };

  for (const row of orderedRows) {
    if (
      row.status_credito &&
      !ELIGIBLE_CREDIT_STATUSES.has(row.status_credito)
    ) {
      continue;
    }
    if (
      row.fecha_inicio_participacion &&
      row.fecha_corte &&
      row.fecha_inicio_participacion > row.fecha_corte
    ) {
      continue;
    }
    const paymentKey = getPaymentKey(row);
    const paymentAllocations = paymentKey
      ? getPaymentAllocations(paymentKey)
      : null;
    const positionKey =
      row.credito_id === undefined
        ? null
        : `${row.credito_id}:${row.inversionista_id}`;
    const initialPosition = new Big(row.monto_aportado)
      .minus(row.monto_pendiente ?? 0)
      .minus(row.capital_pagado_pendiente_liquidar ?? 0);
    const remaining = positionKey
      ? (remainingByPosition.get(positionKey) ??
        (initialPosition.lt(0) ? zero() : initialPosition))
      : initialPosition;
    const currentMonthPurchases = min(
      new Big(row.monto_compras_mes_actual ?? 0),
      remaining,
    );
    const eligibleRemaining = remaining.minus(currentMonthPurchases);
    const hasRawCreditData =
      row.capital_credito !== undefined &&
      row.cuota_credito !== undefined &&
      row.porcentaje_interes !== undefined &&
      row.porcentaje_inversionista !== undefined &&
      row.porcentaje_cube !== undefined;
    const fullInvestorInterest = hasRawCreditData
      ? eligibleRemaining
          .times(row.porcentaje_interes ?? 0)
          .div(100)
          .times(row.porcentaje_inversionista ?? 0)
          .div(100)
          .round(2)
      : new Big(row.interes_inversionista);
    const fullCubeInterest = hasRawCreditData
      ? eligibleRemaining
          .times(row.porcentaje_interes ?? 0)
          .div(100)
          .times(row.porcentaje_cube ?? 0)
          .div(100)
          .round(2)
      : new Big(row.interes_cube);
    const fullInvestorIva = hasRawCreditData
      ? fullInvestorInterest.times("0.12").round(2)
      : new Big(row.iva_inversionista);
    const fullCubeIva = hasRawCreditData
      ? fullCubeInterest.times("0.12").round(2)
      : new Big(row.iva_cube);
    const creditCapital = new Big(row.capital_credito ?? 0);
    const pendingAmount = new Big(row.monto_pendiente ?? 0);
    const isChargeOwner = paymentKey
      ? chargeOwnerByPayment.get(paymentKey) === row.inversionista_id
      : row.es_mayor_participacion;
    const scheduledPayment =
      hasRawCreditData && (pendingAmount.gt(0) || currentMonthPurchases.gt(0))
        ? creditCapital.gt(0)
          ? new Big(row.cuota_credito ?? 0)
              .minus(row.cargos)
              .times(eligibleRemaining)
              .div(creditCapital)
              .round(2)
          : zero()
        : new Big(row.cuota).minus(isChargeOwner ? row.cargos : 0);
    const calculatedCapital = scheduledPayment
      .minus(fullInvestorInterest)
      .minus(fullCubeInterest)
      .minus(fullInvestorIva)
      .minus(fullCubeIva);
    const capital = calculatedCapital.lt(0) ? zero() : calculatedCapital;
    const payableCapital = min(capital, eligibleRemaining);
    if (positionKey) {
      remainingByPosition.set(positionKey, remaining.minus(payableCapital));
    }
    if (row.en_periodo === false) continue;

    const investor = byInvestor.get(row.inversionista_id) ?? {
      inversionista_id: row.inversionista_id,
      nombre: row.nombre,
      montoReinversion: new Big(row.monto_reinversion ?? 0),
      reinversionCapital: zero(),
      reinversionInteres: zero(),
      cashCapital: zero(),
      cashInteres: zero(),
      grossInterest: zero(),
      iva: zero(),
      isr: zero(),
      variable: zero(),
      excedente: zero(),
    };
    const factor =
      row.inversionista_id === CUBE_ID
        ? new Big(1)
        : proportionalFactor(
            row.fecha_inicio_participacion,
            row.fecha_vencimiento,
          );
    const recentPurchases = min(
      new Big(row.monto_compras_mes_anterior ?? 0),
      eligibleRemaining,
    );
    const previousCapital = eligibleRemaining.minus(recentPurchases);
    const fallbackGrossInterest =
      row.inversionista_id === CUBE_ID
        ? fullCubeInterest
        : hasRawCreditData && recentPurchases.gt(0) && previousCapital.gt(0)
          ? previousCapital
              .times(row.porcentaje_interes ?? 0)
              .div(100)
              .times(row.porcentaje_inversionista ?? 0)
              .div(100)
              .round(2)
              .plus(
                recentPurchases
                  .times(row.porcentaje_interes ?? 0)
                  .div(100)
                  .times(row.porcentaje_inversionista ?? 0)
                  .div(100)
                  .times(factor)
                  .round(2),
              )
          : fullInvestorInterest.times(factor).round(2);
    const paymentAllocation = paymentAllocations?.get(row.inversionista_id);
    const grossInterest = paymentAllocation?.interest ?? fallbackGrossInterest;
    const investorIva =
      paymentAllocation?.iva ?? grossInterest.times("0.12").round(2);
    const distributableInterest = row.descuenta_impuestos
      ? grossInterest.times("0.93")
      : row.emite_factura
        ? grossInterest.plus(investorIva)
        : grossInterest.times("0.93");
    investor.grossInterest = investor.grossInterest.plus(grossInterest);
    investor.iva = investor.iva.plus(investorIva);
    if (row.descuenta_impuestos || !row.emite_factura) {
      investor.isr = investor.isr.plus(grossInterest.times("0.07"));
    }

    const shouldApplyVirtualCube =
      row.inversionista_id !== CUBE_ID &&
      paymentKey !== null &&
      virtualCubePayments.has(paymentKey) &&
      !virtualCubeApplied.has(paymentKey);
    if (shouldApplyVirtualCube) {
      const cubeAllocation = paymentAllocations?.get(CUBE_ID);
      const cubeGrossInterest = cubeAllocation?.interest ?? zero();
      const cubeIva = cubeAllocation?.iva ?? zero();
      if (cubeGrossInterest.gt(0) || cubeIva.gt(0)) {
        const cube = byInvestor.get(CUBE_ID) ?? {
          inversionista_id: CUBE_ID,
          nombre: row.cube_nombre ?? "Cube Investments S.A.",
          montoReinversion: new Big(row.cube_monto_reinversion ?? 0),
          reinversionCapital: zero(),
          reinversionInteres: zero(),
          cashCapital: zero(),
          cashInteres: zero(),
          grossInterest: zero(),
          iva: zero(),
          isr: zero(),
          variable: zero(),
          excedente: zero(),
        };
        const cubeDistributableInterest = row.cube_descuenta_impuestos
          ? cubeGrossInterest.times("0.93")
          : row.cube_emite_factura
            ? cubeGrossInterest.plus(cubeIva)
            : cubeGrossInterest.times("0.93");
        cube.grossInterest = cube.grossInterest.plus(cubeGrossInterest);
        cube.iva = cube.iva.plus(cubeIva);
        if (row.cube_descuenta_impuestos || !row.cube_emite_factura) {
          cube.isr = cube.isr.plus(cubeGrossInterest.times("0.07"));
        }
        switch (row.cube_tipo_reinv_efectivo) {
          case "reinversion_interes":
          case "reinversion_total":
            cube.reinversionInteres = cube.reinversionInteres.plus(
              cubeDistributableInterest,
            );
            break;
          case "reinversion_variable":
            cube.variable = cube.variable.plus(cubeDistributableInterest);
            break;
          case "reinversion_excedente":
            cube.excedente = cube.excedente.plus(cubeDistributableInterest);
            break;
          default:
            cube.cashInteres = cube.cashInteres.plus(cubeDistributableInterest);
        }
        byInvestor.set(CUBE_ID, cube);
      }
      virtualCubeApplied.add(paymentKey);
    }

    switch (row.tipo_reinv_efectivo) {
      case "reinversion_capital":
        investor.reinversionCapital = investor.reinversionCapital.plus(payableCapital);
        investor.cashInteres = investor.cashInteres.plus(distributableInterest);
        break;
      case "reinversion_interes":
        investor.cashCapital = investor.cashCapital.plus(payableCapital);
        investor.reinversionInteres = investor.reinversionInteres.plus(distributableInterest);
        break;
      case "reinversion_total":
        investor.reinversionCapital = investor.reinversionCapital.plus(payableCapital);
        investor.reinversionInteres = investor.reinversionInteres.plus(distributableInterest);
        break;
      case "reinversion_variable":
        investor.variable = investor.variable.plus(payableCapital).plus(distributableInterest);
        break;
      case "reinversion_excedente":
        investor.excedente = investor.excedente.plus(payableCapital).plus(distributableInterest);
        break;
      default:
        investor.cashCapital = investor.cashCapital.plus(payableCapital);
        investor.cashInteres = investor.cashInteres.plus(distributableInterest);
    }

    byInvestor.set(row.inversionista_id, investor);
  }

  const projected = [...byInvestor.values()]
    .sort((left, right) => left.nombre.localeCompare(right.nombre))
    .map((investor): ProjectedInvestor => {
      const variableReinvestment = min(
        investor.montoReinversion,
        investor.variable,
      );
      const variableCash = investor.variable.minus(variableReinvestment);
      const excedenteCash = min(investor.montoReinversion, investor.excedente);
      const excedenteReinvestment = investor.excedente.minus(excedenteCash);
      const reinvestmentCapital = investor.reinversionCapital
        .plus(variableReinvestment)
        .plus(excedenteReinvestment);
      const cashCapital = investor.cashCapital
        .plus(variableCash)
        .plus(excedenteCash);
      const reinvestmentCapitalRounded = reinvestmentCapital.toFixed(2);
      const reinvestmentInterestRounded =
        investor.reinversionInteres.toFixed(2);
      const cashCapitalRounded = cashCapital.toFixed(2);
      const cashInterestRounded = investor.cashInteres.toFixed(2);
      const reinvestmentTotal = new Big(reinvestmentCapitalRounded).plus(
        reinvestmentInterestRounded,
      );
      const cashTotal = new Big(cashCapitalRounded).plus(cashInterestRounded);

      return {
        inversionista_id: investor.inversionista_id,
        nombre: investor.nombre,
        reinversion_capital: reinvestmentCapitalRounded,
        reinversion_interes: reinvestmentInterestRounded,
        reinversion_total: reinvestmentTotal.toFixed(2),
        cash_capital: cashCapitalRounded,
        cash_interes: cashInterestRounded,
        cash_total: cashTotal.toFixed(2),
        interes_bruto: investor.grossInterest.toFixed(2),
        iva: investor.iva.toFixed(2),
        isr: investor.isr.toFixed(2),
        total: reinvestmentTotal.plus(cashTotal).toFixed(2),
      };
    });

  const totals = projected.reduce(
    (sum, investor) => ({
      reinvestment: sum.reinvestment.plus(investor.reinversion_total),
      cash: sum.cash.plus(investor.cash_total),
      grossInterest: sum.grossInterest.plus(investor.interes_bruto),
      iva: sum.iva.plus(investor.iva),
      isr: sum.isr.plus(investor.isr),
      total: sum.total.plus(investor.total),
    }),
    {
      reinvestment: zero(),
      cash: zero(),
      grossInterest: zero(),
      iva: zero(),
      isr: zero(),
      total: zero(),
    },
  );

  const flowTotals = (investors: ProjectedInvestor[]) => {
    const sums = investors.reduce(
      (sum, investor) => ({
        reinvestment: sum.reinvestment.plus(investor.reinversion_total),
        cash: sum.cash.plus(investor.cash_total),
        total: sum.total.plus(investor.total),
      }),
      { reinvestment: zero(), cash: zero(), total: zero() },
    );
    return {
      reinversion_total: sums.reinvestment.toFixed(2),
      cash_total: sums.cash.toFixed(2),
      total: sums.total.toFixed(2),
    };
  };

  return {
    porInversionista: projected,
    totales: {
      reinversion_total: totals.reinvestment.toFixed(2),
      cash_total: totals.cash.toFixed(2),
      interes_bruto: totals.grossInterest.toFixed(2),
      iva: totals.iva.toFixed(2),
      isr: totals.isr.toFixed(2),
      total: totals.total.toFixed(2),
      externos: flowTotals(
        projected.filter((investor) => investor.inversionista_id !== CUBE_ID),
      ),
      cube: flowTotals(
        projected.filter((investor) => investor.inversionista_id === CUBE_ID),
      ),
    },
  };
}
