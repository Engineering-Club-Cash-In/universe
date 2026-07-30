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

export const PUBLIC_REINVESTMENT_DETAIL_ERROR =
  "Los detalles no están disponibles para este período. Intenta nuevamente más tarde.";

export function getPublicReinvestmentDetailError(_error: unknown) {
  return PUBLIC_REINVESTMENT_DETAIL_ERROR;
}

export function buildNetInterestDetail(input: NetInterestInput) {
  const sinFactura = cents(input.isr) > 0;
  const interest = cents(input.interes);
  const tax = sinFactura ? cents(input.isr) : cents(input.iva);
  return {
    inversionista_id: input.inversionista_id,
    inversionista: input.inversionista,
    referencia: input.referencia,
    tratamiento_fiscal: sinFactura ? "sin_factura" : "con_factura",
    interes: money(interest),
    iva: money(sinFactura ? 0 : tax),
    isr: money(sinFactura ? tax : 0),
    neto: money(sinFactura ? interest - tax : interest + tax),
  };
}

export function buildInvestorPosition(
  historicalAmount: number,
  reinvestment: number,
  isMay2026: boolean,
) {
  const historical = cents(historicalAmount);
  const reinvested = cents(reinvestment);
  const contributed = isMay2026 ? historical - reinvested : historical;
  return {
    monto_aportado: money(contributed),
    capital_activo: money(contributed + reinvested),
  };
}

type ReconciliationResponse = {
  interesNeto: {
    conFactura: { neto: string };
    sinFactura: { neto: string };
    cube: { neto: string };
  };
  pagosExtras: { abonos_capital: string; cancelaciones: string };
  comprasMes: { tipo: string; cantidad: number; monto: string }[];
  detalleInteresNeto: {
    tratamiento_fiscal: string;
    neto: string;
  }[];
  detallePagosExtras: { tipo: string; monto: string }[];
  detalleComprasMes: { modalidad: string; monto: string }[];
};

const sumCents = (values: (number | string)[]) =>
  values.reduce((total, value) => total + cents(value), 0);

export function assertReportReconciliation(response: ReconciliationResponse) {
  const cubeRows = response.detalleInteresNeto.filter(
    (row) => row.tratamiento_fiscal === "cube",
  );
  const interestSummary = sumCents([
    response.interesNeto.conFactura.neto,
    response.interesNeto.sinFactura.neto,
    response.interesNeto.cube.neto,
  ]);
  const interestDetail = sumCents(
    response.detalleInteresNeto.map((row) => row.neto),
  );
  const interestCategories = [
    ["con_factura", response.interesNeto.conFactura.neto],
    ["sin_factura", response.interesNeto.sinFactura.neto],
    ["cube", response.interesNeto.cube.neto],
  ] as const;
  const interestByCategory = interestCategories.every(
    ([category, summary]) =>
      sumCents(
        response.detalleInteresNeto
          .filter((row) => row.tratamiento_fiscal === category)
          .map((row) => row.neto),
      ) === cents(summary),
  );
  const hasUnknownInterestCategory = response.detalleInteresNeto.some(
    (row) =>
      !interestCategories.some(
        ([category]) => category === row.tratamiento_fiscal,
      ),
  );
  if (
    interestDetail !== interestSummary ||
    !interestByCategory ||
    hasUnknownInterestCategory ||
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
};

export function assertModeReconciliation(mode: ModeReconciliation) {
  const distributed = cents(mode.total_distribuido);
  const destinations = sumCents([
    mode.total_cuota,
    mode.reinversion_total,
  ]);
  const composition =
    sumCents([
      mode.total_capital,
      mode.total_interes,
      mode.iva_facturado,
    ]) - cents(mode.total_isr);
  // Stored components are rounded independently, so their composition can
  // differ by one cent even while the stored destinations reconcile exactly.
  if (
    distributed !== destinations ||
    Math.abs(distributed - composition) > 1
  ) {
    throw new Error("Modalidad no concilia");
  }
  return true;
}
