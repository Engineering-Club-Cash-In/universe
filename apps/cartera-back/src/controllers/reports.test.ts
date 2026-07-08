import { describe, expect, it, mock } from "bun:test";

mock.module("../database", () => ({
  db: {},
  client: {},
}));

mock.module("./credits", () => ({
  getCreditosWithUserByMesAnio: mock(() => Promise.resolve({ data: [] })),
}));

mock.module("./payments", () => ({
  getAllPagosWithCreditAndInversionistas: mock(() => Promise.resolve([])),
  getPagosConInversionistas: mock(() => Promise.resolve([])),
}));

mock.module("@cci/email", () => ({
  sendEmail: mock(() => Promise.resolve()),
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
}));

const { applyEstadoCuentaRunningCapital, buildEstadoCuentaTableHeader, renderEstadoCuentaPaymentRow, shouldIncludeEstadoCuentaPayment, sortEstadoCuentaPayments, esStatusExcluidoMora, esStatusSinFacturacion, escalarCapitalAlPrincipal } = await import("./reports");

describe("estado de cuenta PDF", () => {
  it("incluye la columna de fecha de aplicacion del pago", () => {
    expect(buildEstadoCuentaTableHeader()).toContain("Fecha Aplicación");
  });

  it("muestra fecha_aplicado en el renglon del pago", () => {
    const row = renderEstadoCuentaPaymentRow(
      {
        pago_id: 78303,
        numero_cuota: 17,
        cuota: "2445.18",
        abono_capital: "841.50",
        abono_interes: "812.53",
        abono_iva_12: "97.50",
        abono_seguro: "260.93",
        abono_gps: "0.00",
        membresias_pago: "432.72",
        mora: "0.00",
        monto_aplicado: "2445.18",
        total_restante: "53327.49",
        fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"),
        fecha_aplicado: new Date("2026-05-19T16:36:25.000Z"),
      },
      0,
    );

    expect(row).toContain("19/05/2026");
    expect(row).toContain("15/05/2026");
  });

  it("muestra guion cuando el pago no tiene fecha_aplicado", () => {
    const row = renderEstadoCuentaPaymentRow(
      {
        pago_id: 78304,
        numero_cuota: 18,
        cuota: "2445.18",
        abono_capital: "0.00",
        abono_interes: "0.00",
        abono_iva_12: "0.00",
        abono_seguro: "0.00",
        abono_gps: "0.00",
        membresias_pago: "0.00",
        mora: "0.00",
        monto_aplicado: "0.00",
        total_restante: "54168.99",
        fecha_vencimiento: new Date("2026-06-15T06:00:00.000Z"),
        fecha_aplicado: null,
      },
      0,
    );

    expect(row).toContain("<td>-</td>");
  });

  it("incluye abonos a capital validados aunque no cierren cuota", () => {
    expect(
      shouldIncludeEstadoCuentaPayment({
        pagado: false,
        paymentFalse: false,
        validationStatus: "validated",
        abono_capital: "75000.00",
        monto_aplicado: "75000.00",
      }),
    ).toBe(true);
  });

  it("mantiene incluidos los pagos parciales que ya estan marcados como pagados", () => {
    expect(
      shouldIncludeEstadoCuentaPayment({
        pagado: true,
        paymentFalse: false,
        validationStatus: "pending",
        abono_capital: "0.00",
        abono_interes: "147.78",
        abono_iva_12: "0.00",
        abono_seguro: "0.00",
        abono_gps: "0.00",
        membresias_pago: "0.00",
        monto_aplicado: "147.78",
      }),
    ).toBe(true);
  });

  it("incluye reducciones de capital mixtas cuando ya fueron aplicadas", () => {
    expect(
      shouldIncludeEstadoCuentaPayment({
        pagado: false,
        paymentFalse: false,
        validationStatus: "validated",
        abono_capital: "456.39",
        abono_interes: "0.00",
        abono_iva_12: "0.00",
        abono_seguro: "934.54",
        abono_gps: "0.00",
        membresias_pago: "484.07",
        monto_aplicado: "1875.00",
        fecha_pago: new Date("2026-06-08T22:31:28.000Z"),
        fecha_aplicado: new Date("2026-06-09T21:44:42.260Z"),
      }),
    ).toBe(true);
  });

  it("no incluye cuotas futuras sincronizadas aunque esten validadas", () => {
    expect(
      shouldIncludeEstadoCuentaPayment({
        pagado: false,
        paymentFalse: false,
        validationStatus: "validated",
        abono_capital: "73.68",
        abono_interes: "1060.69",
        abono_iva_12: "127.28",
        abono_seguro: "260.93",
        abono_gps: "0.00",
        membresias_pago: "399.73",
        monto_aplicado: "1922.31",
        fecha_pago: new Date("2030-12-30T06:00:00.000Z"),
        fecha_aplicado: new Date("2030-12-30T06:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("ordena pagos de la misma cuota por fecha de pago", () => {
    const sorted = sortEstadoCuentaPayments([
      {
        pago_id: 134345,
        numero_cuota: 7,
        fecha_pago: new Date("2026-06-01T22:03:29.000Z"),
      },
      {
        pago_id: 17420,
        numero_cuota: 7,
        fecha_pago: new Date("2026-05-29T21:11:16.000Z"),
      },
      {
        pago_id: 127060,
        numero_cuota: 7,
        fecha_pago: new Date("2026-05-09T02:31:31.111Z"),
      },
    ]);

    expect(sorted.map((p) => p.pago_id)).toEqual([127060, 17420, 134345]);
  });

  it("calcula capital restante corrido para parciales y abonos a capital", () => {
    const rows = applyEstadoCuentaRunningCapital([
      {
        pago_id: 17419,
        pagado: true,
        abono_capital: "1319.93",
        abono_interes: "1767.89",
        total_restante: "116539.07",
      },
      {
        pago_id: 127060,
        abono_capital: "0.00",
        total_restante: "0.00",
      },
      {
        pago_id: 17420,
        pagado: true,
        abono_capital: "1342.11",
        abono_interes: "1748.09",
        total_restante: "115196.94",
      },
      {
        pago_id: 134345,
        abono_capital: "75000.00",
        total_restante: "39720.74",
      },
    ]);

    expect(rows.map((p) => p.total_restante)).toEqual([
      "116539.07",
      "116539.07",
      "115196.94",
      "40196.94",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Fix "Totales acumulados" (panel rojo) de Pagos por Vencimiento
// ──────────────────────────────────────────────────────────────────────────
describe("status excluidos del reporte", () => {
  it("excluye de mora y deuda acumulada (panel rojo) los 5 status: convenio/incobrable/cancelado/pend.cancelacion/caido", () => {
    expect(esStatusExcluidoMora("EN_CONVENIO")).toBe(true);
    expect(esStatusExcluidoMora("INCOBRABLE")).toBe(true);
    expect(esStatusExcluidoMora("CANCELADO")).toBe(true);
    expect(esStatusExcluidoMora("PENDIENTE_CANCELACION")).toBe(true);
    expect(esStatusExcluidoMora("CAIDO")).toBe(true);
    expect(esStatusExcluidoMora("ACTIVO")).toBe(false);
    expect(esStatusExcluidoMora("MOROSO")).toBe(false);
    expect(esStatusExcluidoMora(null)).toBe(false);
    expect(esStatusExcluidoMora(undefined)).toBe(false);
  });

  it("excluye del esperado del mes (panel azul) SOLO los muertos; EN_CONVENIO y CAIDO sí facturan", () => {
    expect(esStatusSinFacturacion("CANCELADO")).toBe(true);
    expect(esStatusSinFacturacion("INCOBRABLE")).toBe(true);
    expect(esStatusSinFacturacion("PENDIENTE_CANCELACION")).toBe(true);
    // estos generan ingreso esperado aunque no generen mora:
    expect(esStatusSinFacturacion("EN_CONVENIO")).toBe(false);
    expect(esStatusSinFacturacion("CAIDO")).toBe(false);
    expect(esStatusSinFacturacion("ACTIVO")).toBe(false);
  });
});

describe("escalarCapitalAlPrincipal (tope de la deuda de capital acumulada)", () => {
  const cuota = (capital: string, interes = "0.00", iva = "0.00", seguro = "0.00", gps = "0.00", membresias = "0.00") => ({
    capital_restante: capital, interes_restante: interes, iva_12_restante: iva,
    seguro_restante: seguro, gps_restante: gps, membresias,
  });

  it("morosos normales (suma de capital ≤ principal): factor 1, no toca el capital", () => {
    const cuotas = [cuota("1000.00", "200.00", "24.00", "50.00", "0.00", "30.00"), cuota("1000.00", "200.00", "24.00", "50.00", "0.00", "30.00")];
    const out = escalarCapitalAlPrincipal(cuotas, 100000);
    expect(out.map((c) => c.capital_restante)).toEqual(["1000.00", "1000.00"]);
    // total_restante = capital + interes + iva + seguro + gps + membresias
    expect(out[0].total_restante).toBe("1304.00");
  });

  it("cuota ≈ capital: escala proporcional para que la suma = principal (no sobre-cuenta)", () => {
    const cuotas = [cuota("70000.00"), cuota("70000.00")]; // suma 140000
    const out = escalarCapitalAlPrincipal(cuotas, 70000);  // factor 0.5
    expect(out.map((c) => c.capital_restante)).toEqual(["35000.00", "35000.00"]);
    const sumaCap = out.reduce((s, c) => s + Number(c.capital_restante), 0);
    expect(sumaCap).toBeCloseTo(70000, 2);
  });

  it("crédito con capital=0: el principal es 0 → toda la deuda de capital va a 0", () => {
    const out = escalarCapitalAlPrincipal([cuota("233021.46")], 0);
    expect(out[0].capital_restante).toBe("0.00");
    expect(out[0].total_restante).toBe("0.00");
  });

  it("no infla cuando hay tolerancia de centavos (suma apenas sobre principal)", () => {
    const out = escalarCapitalAlPrincipal([cuota("100.00")], 100.005);
    expect(out[0].capital_restante).toBe("100.00"); // dentro de la tolerancia → factor 1
  });
});
