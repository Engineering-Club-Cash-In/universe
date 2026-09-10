import Big from "big.js";

type NetInterestInput = {
  inversionista_id: number;
  inversionista: string;
  referencia: string;
  interes: number | string;
  iva: number | string;
  isr: number | string;
};

const cents = (value: number | string) =>
  new Big(value).times(100).round(0, Big.roundHalfUp).toNumber();
const money = (valueInCents: number) => (valueInCents / 100).toFixed(2);

type LiquidationCompositionInput = {
  totalCapital: number | string;
  paidTotal: number | string;
  reinvestedCapital: number | string;
  reinvestedRest: number | string;
  reinvestedTotal: number | string;
};

type ReinvestmentComponentsInput = Pick<
  LiquidationCompositionInput,
  "reinvestedCapital" | "reinvestedRest" | "reinvestedTotal"
>;

export function normalizeReinvestmentComponents(
  input: ReinvestmentComponentsInput,
) {
  let capital = new Big(input.reinvestedCapital).times(100).round(0, Big.roundHalfUp);
  let rest = new Big(input.reinvestedRest).times(100).round(0, Big.roundHalfUp);
  const total = new Big(input.reinvestedTotal).times(100).round(0, Big.roundHalfUp);
  let unclassified = total.minus(capital).minus(rest);

  // Liquidaciones históricas redondearon total y componentes por separado. La
  // deriva observada es de un centavo; el total acreditado a saldo_reinversion
  // es el techo contable y el resto (interés/IVA/ISR) absorbe ese centavo.
  if (unclassified.eq(-1)) {
    if (rest.gt(0)) rest = rest.minus(1);
    else if (capital.gt(0)) capital = capital.minus(1);
    unclassified = new Big(0);
  }

  if (
    [capital, rest, total].some((value) => value.lt(0)) ||
    unclassified.lt(0)
  ) {
    throw new Error("Composición de liquidación inválida");
  }

  return {
    capital: capital.div(100).toFixed(2),
    rest: rest.div(100).toFixed(2),
    total: total.div(100).toFixed(2),
    unclassified: unclassified.div(100).toFixed(2),
  };
}

export function assertLiquidationRowsReinvestmentIntegrity(
  rows: ReinvestmentComponentsInput[],
) {
  for (const row of rows) normalizeReinvestmentComponents(row);
}

type InvestorLiquidationRow = ReinvestmentComponentsInput & {
  inversionistaId: number;
  nombre: string;
  tipoReinversion: string;
  paidTotal: number | string;
  totalCapital: number | string;
};

export function aggregateInvestorLiquidationRows(rows: InvestorLiquidationRow[]) {
  const totals = new Map<number, {
    inversionista_id: number;
    nombre: string;
    tipo_reinversion: string;
    reinversion_capital: Big;
    reinversion_interes: Big;
    reinversion: Big;
    a_recibir: Big;
    total_capital: Big;
  }>();

  for (const row of rows) {
    const normalized = normalizeReinvestmentComponents(row);
    const current = totals.get(row.inversionistaId);
    if (!current) {
      totals.set(row.inversionistaId, {
        inversionista_id: row.inversionistaId,
        nombre: row.nombre,
        tipo_reinversion: row.tipoReinversion,
        reinversion_capital: new Big(normalized.capital),
        reinversion_interes: new Big(normalized.rest),
        reinversion: new Big(normalized.total),
        a_recibir: new Big(row.paidTotal),
        total_capital: new Big(row.totalCapital),
      });
      continue;
    }
    if (current.tipo_reinversion !== row.tipoReinversion) {
      current.tipo_reinversion = "sin_clasificar";
    }
    current.reinversion_capital = current.reinversion_capital.plus(normalized.capital);
    current.reinversion_interes = current.reinversion_interes.plus(normalized.rest);
    current.reinversion = current.reinversion.plus(normalized.total);
    current.a_recibir = current.a_recibir.plus(row.paidTotal);
    current.total_capital = current.total_capital.plus(row.totalCapital);
  }

  return [...totals.values()].map((row) => ({
    inversionista_id: row.inversionista_id,
    nombre: row.nombre,
    tipo_reinversion: row.tipo_reinversion,
    reinversion_capital: row.reinversion_capital.toFixed(2),
    reinversion_interes: row.reinversion_interes.toFixed(2),
    reinversion: row.reinversion.toFixed(2),
    a_recibir: row.a_recibir.toFixed(2),
    total_capital: row.total_capital.toFixed(2),
  }));
}

export function buildLiquidationComposition(input: LiquidationCompositionInput) {
  const toBigCents = (value: number | string) =>
    new Big(value).times(100).round(0, Big.roundHalfUp);
  const fromBigCents = (value: Big) => value.div(100).toFixed(2);
  const flowCapital = toBigCents(input.totalCapital);
  const paidTotal = toBigCents(input.paidTotal);
  const normalizedReinvestment = normalizeReinvestmentComponents(input);
  const reinvestedCapital = toBigCents(normalizedReinvestment.capital);
  const reinvestedRest = toBigCents(normalizedReinvestment.rest);
  const reinvestedTotal = toBigCents(normalizedReinvestment.total);
  const flowTotal = paidTotal.plus(reinvestedTotal);
  const flowRest = flowTotal.minus(flowCapital);
  const reinvestedUnclassified = toBigCents(normalizedReinvestment.unclassified);

  if (
    [flowCapital, paidTotal, reinvestedCapital, reinvestedRest, reinvestedTotal]
      .some((value) => value.lt(0)) ||
    flowRest.lt(0) ||
    reinvestedUnclassified.lt(0)
  ) {
    throw new Error("Composición de liquidación inválida");
  }

  let paidCapital = new Big(0);
  let paidRest = new Big(0);
  let paidUnclassified = paidTotal;
  if (reinvestedUnclassified.eq(0)) {
    paidCapital = flowCapital.minus(reinvestedCapital);
    paidRest = flowRest.minus(reinvestedRest);
    if (paidCapital.lt(0) || paidRest.lt(0)) {
      throw new Error("Composición de liquidación inválida");
    }
    paidUnclassified = new Big(0);
  }

  return {
    pagado: {
      capital: fromBigCents(paidCapital),
      resto: fromBigCents(paidRest),
      sin_clasificar: fromBigCents(paidUnclassified),
      total: fromBigCents(paidTotal),
    },
    reinvertido: {
      capital: fromBigCents(reinvestedCapital),
      resto: fromBigCents(reinvestedRest),
      sin_clasificar: fromBigCents(reinvestedUnclassified),
      total: fromBigCents(reinvestedTotal),
    },
    flujo: {
      capital: fromBigCents(flowCapital),
      resto: fromBigCents(flowRest),
      total: fromBigCents(flowTotal),
    },
    estado: reinvestedUnclassified.eq(0) ? "exacto" : "sin_clasificar",
  } as const;
}

type PurchaseClassification =
  | "nueva_posicion"
  | "ampliacion_posicion"
  | "sin_clasificar";

type PurchaseDetail = {
  modalidad_facturacion: string;
  tipo_reinversion: string;
  tipo_compra: PurchaseClassification;
  monto: number | string;
};

const purchaseKey = (row: Omit<PurchaseDetail, "monto">) =>
  `${row.modalidad_facturacion}\u0000${row.tipo_reinversion}\u0000${row.tipo_compra}`;

export function summarizePurchaseDetails(rows: PurchaseDetail[]) {
  const summaries = new Map<
    string,
    Omit<PurchaseDetail, "monto"> & { cantidad: number; monto: Big }
  >();
  for (const row of rows) {
    const key = purchaseKey(row);
    const current = summaries.get(key) ?? {
      modalidad_facturacion: row.modalidad_facturacion,
      tipo_reinversion: row.tipo_reinversion,
      tipo_compra: row.tipo_compra,
      cantidad: 0,
      monto: new Big(0),
    };
    current.cantidad += 1;
    current.monto = current.monto.plus(row.monto);
    summaries.set(key, current);
  }
  return [...summaries.values()].map(({ monto, ...summary }) => ({
    ...summary,
    monto: monto.toFixed(2),
  }));
}

type PurchaseTicketRow = Pick<PurchaseDetail, "tipo_compra" | "monto"> & {
  periodo: string;
  cantidad?: number;
};

const previousPeriod = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
};

export function buildPurchaseTicketHistory(
  rows: PurchaseTicketRow[],
  targetPeriod: string,
) {
  const months = new Map<string, { cantidad: number; monto: Big }>();
  for (const row of rows) {
    if (row.tipo_compra !== "nueva_posicion") continue;
    const current = months.get(row.periodo) ?? {
      cantidad: 0,
      monto: new Big(0),
    };
    current.cantidad += row.cantidad ?? 1;
    current.monto = current.monto.plus(row.monto);
    months.set(row.periodo, current);
  }
  const historico = [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([periodo, month]) => ({
      periodo,
      cantidad: month.cantidad,
      monto_total: month.monto.toFixed(2),
      ticket_promedio: month.monto.div(month.cantidad).toFixed(2),
    }));
  const current = historico.find((month) => month.periodo === targetPeriod) ?? {
    periodo: targetPeriod,
    cantidad: 0,
    monto_total: "0.00",
    ticket_promedio: "0.00",
  };
  const previous = historico.find(
    (month) => month.periodo === previousPeriod(targetPeriod),
  );
  const variation = previous && new Big(previous.ticket_promedio).gt(0)
    ? new Big(current.ticket_promedio)
      .minus(previous.ticket_promedio)
      .div(previous.ticket_promedio)
      .times(100)
      .toFixed(2)
    : null;

  return {
    actual: { ...current, variacion_porcentual: variation },
    historico,
  };
}

export function buildCubeNetInterest(value: number | string) {
  const interest = new Big(value).round(2, Big.roundHalfUp);
  const tax = new Big(value).times("0.12").round(2, Big.roundHalfUp);
  return {
    interes: interest.toFixed(2),
    iva: tax.toFixed(2),
    neto: interest.plus(tax).toFixed(2),
  };
}

function allocateRoundedAmountsToTarget(
  values: (number | string)[],
  target: Big,
) {
  const rawCents = values.map((value) => new Big(value).times(100));
  const allocated = rawCents.map((value) => value.round(0, Big.roundDown));
  const delta = target.minus(
    allocated.reduce((total, value) => total.plus(value), new Big(0)),
  );
  const direction = delta.cmp(0);
  const order = rawCents
    .map((value, index) => ({
      index,
      remainder: value.minus(allocated[index]),
    }))
    .sort((a, b) => {
      const difference = direction * b.remainder.cmp(a.remainder);
      return difference !== 0 ? difference : a.index - b.index;
    });

  if (direction > 0) {
    if (order.length === 0) {
      throw new Error("No se pudo distribuir el residuo monetario");
    }
    const count = new Big(order.length);
    const rounds = delta.div(count).round(0, Big.roundDown);
    for (const destination of order) {
      allocated[destination.index] = allocated[destination.index].plus(rounds);
    }
    const residual = delta.minus(rounds.times(count)).toNumber();
    for (let index = 0; index < residual; index++) {
      const destination = order[index];
      if (!destination) break;
      allocated[destination.index] = allocated[destination.index].plus(1);
    }
  } else if (direction < 0) {
    let remaining = delta.abs();
    let processed = new Big(0);
    while (remaining.gt(0)) {
      const eligible = order.filter(({ index }) => allocated[index].gt(0));
      if (eligible.length === 0) {
        throw new Error("No se pudo distribuir el residuo monetario sin negativos");
      }
      const count = new Big(eligible.length);
      const requestedRounds = remaining.div(count).round(0, Big.roundDown);
      if (requestedRounds.gt(0)) {
        const firstEligible = eligible[0];
        if (!firstEligible) {
          throw new Error("No se pudo distribuir el residuo monetario sin negativos");
        }
        const availableRounds = eligible.reduce(
          (minimum, { index }) =>
            minimum.lt(allocated[index]) ? minimum : allocated[index],
          allocated[firstEligible.index],
        );
        const safeAvailableRounds = availableRounds.minus(1);
        const rounds = requestedRounds.lt(safeAvailableRounds)
          ? requestedRounds
          : safeAvailableRounds;
        if (rounds.gt(0)) {
          for (const destination of eligible) {
            allocated[destination.index] = allocated[destination.index].minus(rounds);
          }
          const distributed = rounds.times(count);
          remaining = remaining.minus(distributed);
          processed = processed.plus(distributed);
          continue;
        }
      }
      const destination = eligible[processed.mod(count).toNumber()];
      if (!destination) {
        throw new Error("No se pudo distribuir el residuo monetario sin negativos");
      }
      allocated[destination.index] = allocated[destination.index].minus(1);
      remaining = remaining.minus(1);
      processed = processed.plus(1);
    }
  }

  return allocated.map((value) => value.div(100).toFixed(2));
}

export function allocateRoundedAmounts(values: (number | string)[]) {
  const rawCents = values.map((value) => new Big(value).times(100));
  const allocated = rawCents.map((value) => value.round(0, Big.roundHalfUp));
  const target = values
    .reduce((total, value) => total.plus(value), new Big(0))
    .times(100)
    .round(0, Big.roundHalfUp);
  const remainder = target
    .minus(allocated.reduce((total, value) => total.plus(value), new Big(0)))
    .toNumber();
  const direction = Math.sign(remainder);
  const order = rawCents
    .map((value, index) => ({
      index,
      remainder: value.minus(allocated[index]),
    }))
    .sort((a, b) => {
      const difference = direction * b.remainder.cmp(a.remainder);
      return difference !== 0 ? difference : a.index - b.index;
    });

  for (let index = 0; index < Math.abs(remainder); index++) {
    const destination = order[index % order.length];
    if (!destination) break;
    allocated[destination.index] = allocated[destination.index].plus(direction);
  }

  return allocated.map((value) => value.div(100).toFixed(2));
}

type LiquidationModeAllocationRow = {
  reinversion_capital: string;
  reinversion_interes: string;
  reinversion_total: string;
  total_capital: string;
  total_interes: string;
  total_iva: string;
  total_isr: string;
  total_distribuido: string;
};

export function canonicalizeLiquidationModeRows<T extends LiquidationModeAllocationRow>(rows: T[]) {
  const allocate = (field: keyof LiquidationModeAllocationRow) =>
    allocateRoundedAmounts(rows.map((row) => row[field]));
  const targetCents = (values: (number | string)[]) =>
    values
      .reduce((total, value) => total.plus(value), new Big(0))
      .times(100)
      .round(0, Big.roundHalfUp);
  const clampTarget = (value: Big, lower: Big, upper: Big) =>
    value.lt(lower) ? lower : value.gt(upper) ? upper : value;

  const reinvestedCapitalRaw = rows.map((row) => row.reinversion_capital);
  const reinvestedRestRaw = rows.map((row) => row.reinversion_interes);
  const reinvestedUnclassifiedRaw = rows.map((row) =>
    new Big(row.reinversion_total)
      .minus(row.reinversion_capital)
      .minus(row.reinversion_interes)
      .toString(),
  );
  const paidCapitalRaw = rows.map((row) =>
    new Big(row.total_capital).minus(row.reinversion_capital).toString(),
  );
  const paidRestRaw = rows.map((row) =>
    new Big(row.total_distribuido)
      .minus(row.reinversion_total)
      .minus(new Big(row.total_capital).minus(row.reinversion_capital))
      .toString(),
  );

  const reinvestedCapitalTarget = targetCents(reinvestedCapitalRaw);
  const totalCapitalTarget = targetCents(rows.map((row) => row.total_capital));
  const totalFlowTarget = targetCents(rows.map((row) => row.total_distribuido));
  const paidCapitalTarget = totalCapitalTarget.minus(reinvestedCapitalTarget);
  const reinvestedTotalTarget = clampTarget(
    targetCents(rows.map((row) => row.reinversion_total)),
    reinvestedCapitalTarget,
    totalFlowTarget.minus(paidCapitalTarget),
  );
  const reinvestedNonCapitalTarget = reinvestedTotalTarget.minus(
    reinvestedCapitalTarget,
  );
  const reinvestedRestTarget = clampTarget(
    targetCents(reinvestedRestRaw),
    new Big(0),
    reinvestedNonCapitalTarget,
  );
  const reinvestedUnclassifiedTarget = reinvestedNonCapitalTarget.minus(
    reinvestedRestTarget,
  );
  const paidTotalTarget = totalFlowTarget.minus(reinvestedTotalTarget);
  const paidRestTarget = paidTotalTarget.minus(paidCapitalTarget);

  const reinvestedCapital = allocateRoundedAmountsToTarget(
    reinvestedCapitalRaw,
    reinvestedCapitalTarget,
  );
  const reinvestedRest = allocateRoundedAmountsToTarget(
    reinvestedRestRaw,
    reinvestedRestTarget,
  );
  const reinvestedUnclassified = allocateRoundedAmountsToTarget(
    reinvestedUnclassifiedRaw,
    reinvestedUnclassifiedTarget,
  );
  const paidCapital = allocateRoundedAmountsToTarget(
    paidCapitalRaw,
    paidCapitalTarget,
  );
  const paidRest = allocateRoundedAmountsToTarget(paidRestRaw, paidRestTarget);
  const paid = paidCapital.map((value, index) =>
    new Big(value).plus(paidRest[index]).toFixed(2),
  );
  const totalCapital = reinvestedCapital.map((value, index) =>
    new Big(value).plus(paidCapital[index]).toFixed(2),
  );
  const totalInterest = allocate("total_interes");
  const totalIva = allocate("total_iva");
  const totalIsr = allocate("total_isr");

  return rows.map((row, index) => {
    const reinvestedTotal = new Big(reinvestedCapital[index])
      .plus(reinvestedRest[index])
      .plus(reinvestedUnclassified[index]);
    return {
      ...row,
      reinversion_capital: reinvestedCapital[index],
      reinversion_interes: reinvestedRest[index],
      reinversion_total: reinvestedTotal.toFixed(2),
      total_capital: totalCapital[index],
      total_interes: totalInterest[index],
      total_iva: totalIva[index],
      total_isr: totalIsr[index],
      total_cuota: paid[index],
      total_distribuido: reinvestedTotal.plus(paid[index]).toFixed(2),
    };
  });
}

export function allocateRoundedPurchaseAmounts<
  T extends { modalidad: string; monto: number | string },
>(rows: T[]) {
  const allocated = rows.map((row) => ({ ...row, monto: String(row.monto) }));
  for (const modalidad of new Set(rows.map((row) => row.modalidad))) {
    const modeRows = allocated.filter((row) => row.modalidad === modalidad);
    const amounts = allocateRoundedAmounts(modeRows.map((row) => row.monto));
    modeRows.forEach((row, index) => {
      row.monto = amounts[index];
    });
  }
  return allocated;
}

export function canonicalizePurchaseSummaries(
  rows: { tipo: string | null; cantidad: number; monto: string }[],
) {
  const summaries = new Map<string, { cantidad: number; monto: Big }>();
  for (const row of rows) {
    const tipo = row.tipo ?? "sin_reinversion";
    const current = summaries.get(tipo) ?? { cantidad: 0, monto: new Big(0) };
    current.cantidad += row.cantidad;
    current.monto = current.monto.plus(row.monto);
    summaries.set(tipo, current);
  }
  return [...summaries.entries()].map(([tipo, summary]) => ({
    tipo,
    cantidad: summary.cantidad,
    monto: summary.monto.toFixed(2),
  }));
}

export const PUBLIC_REINVESTMENT_DETAIL_ERROR =
  "Los detalles no están disponibles para este período. Intenta nuevamente más tarde.";

export function getPublicReinvestmentDetailError(_error: unknown) {
  return PUBLIC_REINVESTMENT_DETAIL_ERROR;
}

export function buildNetInterestDetail(input: NetInterestInput) {
  const interest = cents(input.interes);
  return {
    inversionista_id: input.inversionista_id,
    inversionista: input.inversionista,
    referencia: input.referencia,
    // No existe una marca fiscal inmutable en la liquidación. ISR e IVA por sí
    // solos no prueban que se emitió factura, por lo que no se asignan fiscalmente.
    tratamiento_fiscal: "no_verificado" as const,
    interes: money(interest),
    iva: money(cents(input.iva)),
    isr: money(cents(input.isr)),
  };
}

type InvestorPosition = {
  reinversion: string;
  a_recibir: string;
  capital_activo: string;
};

export function shouldIncludeInvestorPosition(position: InvestorPosition) {
  return (
    Number(position.reinversion) !== 0 ||
    Number(position.a_recibir) !== 0 ||
    Number(position.capital_activo) !== 0
  );
}

export function calculateActiveCapital(
  mirrorAmount: number | string,
  pendingPurchaseAmount: number | string,
) {
  return new Big(mirrorAmount).minus(pendingPurchaseAmount).toFixed(2);
}

type NoVerificadoInterestDetail = {
  tratamiento_fiscal: "no_verificado";
  interes: string;
  iva: string;
  isr: string;
  neto?: never;
};
type CubeInterestDetail = {
  tratamiento_fiscal: "cube";
  interes: string;
  iva: string;
  isr: string;
  neto: string;
};
type ReconciliationResponse = {
  interesNeto: {
    noVerificado: { interes: string };
    cube: { neto: string };
  };
  pagosExtras: { abonos_capital: string; cancelaciones: string };
  comprasMes: (
    | { tipo: string; cantidad: number; monto: string }
    | (Omit<PurchaseDetail, "monto"> & { cantidad: number; monto: string })
  )[];
  detalleInteresNeto: (NoVerificadoInterestDetail | CubeInterestDetail)[];
  detallePagosExtras: { tipo: string; monto: string }[];
  detalleComprasMes: (
    | {
      modalidad: string;
      monto: string;
      fecha?: string;
      inversionista?: string;
    }
    | PurchaseDetail
  )[];
};

const sumCents = (values: (number | string)[]) =>
  values.reduce<number>((total, value) => total + cents(value), 0);

const purchaseSummaryKey = (row: ReconciliationResponse["comprasMes"][number]) =>
  "tipo" in row ? row.tipo : purchaseKey(row);
const purchaseDetailKey = (
  row: ReconciliationResponse["detalleComprasMes"][number],
) => "modalidad" in row ? row.modalidad : purchaseKey(row);

export function assertReportReconciliation(response: ReconciliationResponse) {
  const cubeRows = response.detalleInteresNeto.filter(
    (row): row is CubeInterestDetail => row.tratamiento_fiscal === "cube",
  );
  const noVerificadoRows = response.detalleInteresNeto.filter(
    (row): row is NoVerificadoInterestDetail =>
      row.tratamiento_fiscal === "no_verificado",
  );
  const noVerificadoMatches =
    sumCents(noVerificadoRows.map((row) => row.interes)) ===
      cents(response.interesNeto.noVerificado.interes);
  const cubeMatches = sumCents(cubeRows.map((row) => row.neto)) ===
    cents(response.interesNeto.cube.neto);
  if (
    !noVerificadoMatches ||
    !cubeMatches ||
    cubeRows.length > 1
  ) {
    throw new Error("Detalle de interés neto no concilia");
  }

  const extrasSummary = sumCents([
    response.pagosExtras.abonos_capital,
    response.pagosExtras.cancelaciones,
  ]);
  const extrasByCategory =
    sumCents(
      response.detallePagosExtras
        .filter((row) => row.tipo === "abono_capital")
        .map((row) => row.monto),
    ) === cents(response.pagosExtras.abonos_capital) &&
    sumCents(
      response.detallePagosExtras
        .filter((row) => row.tipo === "cancelacion")
        .map((row) => row.monto),
    ) === cents(response.pagosExtras.cancelaciones);
  const hasUnknownExtraCategory = response.detallePagosExtras.some(
    (row) => row.tipo !== "abono_capital" && row.tipo !== "cancelacion",
  );
  if (
    sumCents(response.detallePagosExtras.map((row) => row.monto)) !==
      extrasSummary ||
    !extrasByCategory ||
    hasUnknownExtraCategory
  ) {
    throw new Error("Detalle de pagos extras no concilia");
  }

  const purchasesByMode = response.comprasMes.every(
    (summary) =>
      response.detalleComprasMes.filter(
        (row) => purchaseDetailKey(row) === purchaseSummaryKey(summary),
      ).length === summary.cantidad &&
      sumCents(
        response.detalleComprasMes
          .filter((row) => purchaseDetailKey(row) === purchaseSummaryKey(summary))
          .map((row) => row.monto),
      ) === cents(summary.monto),
  );
  const hasUnknownPurchaseMode = response.detalleComprasMes.some(
    (row) => !response.comprasMes.some(
      (summary) => purchaseSummaryKey(summary) === purchaseDetailKey(row),
    ),
  );
  if (
    sumCents(response.detalleComprasMes.map((row) => row.monto)) !==
      sumCents(response.comprasMes.map((row) => row.monto)) ||
    !purchasesByMode ||
    hasUnknownPurchaseMode
  ) {
    throw new Error("Detalle de compras del mes no concilia");
  }

  return {
    interesNeto: true,
    pagosExtras: true,
    comprasMes: true,
  };
}

type ModeReconciliation = {
  reinversion_capital: string;
  reinversion_interes: string;
  reinversion_total: string;
  total_capital: string;
  total_interes: string;
  iva_facturado: string;
  total_isr: string;
  total_cuota: string;
  total_distribuido: string;
  cantidad_liquidaciones: number;
};

export function assertModeReconciliation(mode: ModeReconciliation) {
  const distributed = cents(mode.total_distribuido);
  const destinations = sumCents([
    mode.total_cuota,
    mode.reinversion_total,
  ]);
  if (distributed !== destinations) {
    throw new Error("Modalidad no concilia");
  }
  return true;
}
