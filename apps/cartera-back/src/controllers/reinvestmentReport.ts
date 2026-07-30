type NetInterestInput = {
  inversionista_id: number;
  inversionista: string;
  referencia: string;
  interes: number;
  iva: number;
  isr: number;
};

const cents = (value: number | string) => Math.round(Number(value) * 100);
const money = (valueInCents: number) => (valueInCents / 100).toFixed(2);

export function buildCubeNetInterest(value: number) {
  const interest = cents(value);
  const tax = cents(value * 0.12);
  return {
    interes: money(interest),
    iva: money(tax),
    neto: money(interest + tax),
  };
}

export function allocateRoundedAmounts(values: (number | string)[]) {
  const rawCents = values.map((value) => Number(value) * 100);
  const allocated = rawCents.map(Math.round);
  const remainder = cents(values.reduce((total, value) => total + Number(value), 0)) -
    allocated.reduce((total, value) => total + value, 0);
  const direction = Math.sign(remainder);
  const order = rawCents
    .map((value, index) => ({ index, remainder: value - allocated[index] }))
    .sort((a, b) => direction * (b.remainder - a.remainder));

  for (let index = 0; index < Math.abs(remainder); index++) {
    allocated[order[index].index] += direction;
  }

  return allocated.map(money);
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
  const summaries = new Map<string, { cantidad: number; monto: number }>();
  for (const row of rows) {
    const tipo = row.tipo ?? "sin_reinversion";
    const current = summaries.get(tipo) ?? { cantidad: 0, monto: 0 };
    current.cantidad += row.cantidad;
    current.monto += Number(row.monto);
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
    tratamiento_fiscal: "no_verificado",
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
  return Number(mirrorAmount) - Number(pendingPurchaseAmount);
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
  comprasMes: { tipo: string; cantidad: number; monto: string }[];
  detalleInteresNeto: (NoVerificadoInterestDetail | CubeInterestDetail)[];
  detallePagosExtras: { tipo: string; monto: string }[];
  detalleComprasMes: { modalidad: string; monto: string }[];
};

const sumCents = (values: (number | string)[]) =>
  values.reduce((total, value) => total + cents(value), 0);

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
        (row) => row.modalidad === summary.tipo,
      ).length === summary.cantidad &&
      sumCents(
        response.detalleComprasMes
          .filter((row) => row.modalidad === summary.tipo)
          .map((row) => row.monto),
      ) === cents(summary.monto),
  );
  const hasUnknownPurchaseMode = response.detalleComprasMes.some(
    (row) => !response.comprasMes.some((summary) => summary.tipo === row.modalidad),
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
