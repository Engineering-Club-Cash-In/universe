import { describe, expect, it, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { lockPoolMock } from "../utils/testMocks";

mock.module("../database", () => ({
  db: {},
  client: {},
  // Requerido por la cadena de imports (addInvestorToCredit → creditoEspejoLock),
  // aunque estos tests no lo usen. Ver testMocks.ts.
  lockPool: lockPoolMock,
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

const { applyEstadoCuentaRunningCapital, buildCapitalHistoryBeforePeriodLateral, buildEstadoCuentaTableHeader, buildPreviousCapitalBalanceLateral, capitalAtPeriodStartSql, renderEstadoCuentaPaymentRow, resolveCapitalAtPeriodStart, shouldIncludeEstadoCuentaPayment, sortEstadoCuentaPayments, esStatusExcluidoMora, esStatusSinFacturacion, escalarCapitalAlPrincipal } = await import("./reports");

describe("Pagos por Vencimiento: saldo anterior", () => {
  it("prioriza el capital auditado en cero sobre el saldo positivo legado", () => {
    expect(
      resolveCapitalAtPeriodStart({
        historicalCapital: "0.00",
        legacyCapital: "7410.25",
        currentCapital: "-0.01",
      }),
    ).toBe("0.00");
  });

  it("conserva el fallback legado para créditos sin historial de capital", () => {
    expect(
      resolveCapitalAtPeriodStart({
        historicalCapital: null,
        legacyCapital: "7410.25",
        currentCapital: "5200.00",
      }),
    ).toBe("7410.25");
  });

  it("no cambia saldos positivos existentes fuera del caso de liquidación", () => {
    expect(
      resolveCapitalAtPeriodStart({
        historicalCapital: "5200.00",
        legacyCapital: "7410.25",
        currentCapital: "5200.00",
      }),
    ).toBe("7410.25");
  });

  it("nunca convierte un capital actual negativo en expectativa", () => {
    expect(
      resolveCapitalAtPeriodStart({
        historicalCapital: null,
        legacyCapital: null,
        currentCapital: "-0.01",
      }),
    ).toBe("0.00");
  });

  it("lee el último cambio auditado anterior al período en hora de Guatemala", () => {
    const query = new PgDialect().sqlToQuery(
      buildCapitalHistoryBeforePeriodLateral("2026-08-01"),
    );

    expect(query.sql).toContain("cartera.historial_capital_credito");
    expect(query.sql).toContain("capital_nuevo");
    expect(query.sql).toContain("AT TIME ZONE 'America/Guatemala'");
    expect(query.sql).toContain("ORDER BY h.fecha DESC, h.id DESC");
    expect(query.sql).not.toContain("pagos_credito");
    expect(query.params).toEqual(["2026-08-01"]);
  });

  it("mantiene el fallback legado sin ampliar filas de pago elegibles", () => {
    const query = new PgDialect().sqlToQuery(
      buildPreviousCapitalBalanceLateral("2026-08-01"),
    );

    expect(query.sql).toContain("pc_a.total_restante::numeric > 0");
    expect(query.sql).not.toContain("validation_status");
    expect(query.sql).not.toContain("fecha_aplicado");
    expect(query.sql).toContain("pc_a.fecha_boleta::date");
    expect(query.sql).toContain("pc_a.fecha_pago::date");
    expect(query.sql).toContain("'1900-01-01'::date");
    const normalizedSql = query.sql.replace(/\s+/g, " ");
    const baselineDateExpression =
      "COALESCE( qcc_a.fecha_vencimiento::date, GREATEST( COALESCE( pc_a.fecha_boleta::date, pc_a.fecha_pago::date, '1900-01-01'::date ), COALESCE( pc_a.fecha_pago::date, pc_a.fecha_boleta::date, '1900-01-01'::date ) ) )";
    expect(normalizedSql.split(baselineDateExpression)).toHaveLength(3);
  });

  it("usa el historial solo como guard de liquidación en los totales SQL", () => {
    const query = new PgDialect().sqlToQuery(capitalAtPeriodStartSql);

    expect(query.sql).toContain(
      "WHEN capital_historial.capital_nuevo <= 0 THEN 0",
    );
    expect(query.sql).toContain("cap_anterior.total_restante");
    expect(query.sql).toContain("c.capital::numeric");
  });
});

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

  it("excluye pagos pendientes aunque la cuota ya esté marcada como pagada", () => {
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
    ).toBe(false);
  });

  it("mantiene incluidos los pagos parciales que ya están marcados como pagados", () => {
    expect(
      shouldIncludeEstadoCuentaPayment({
        pagado: true,
        paymentFalse: false,
        validationStatus: "validated",
        abono_capital: "400.00",
        monto_aplicado: "400.00",
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

  it("no resta dos veces el abono a capital cuando la fila ya viene neta (sync Excel)", () => {
    // Crédito 01010214106990, cuota 35: la sync escribe el mismo total_restante
    // (ya neto del abono de Q2,440.50) en ambos pagos de la cuota.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 10747, numero_cuota: 33, pagado: true, abono_capital: "1841.92", abono_interes: "850.00", total_restante: "54555.42" },
      { pago_id: 10748, numero_cuota: 34, pagado: true, abono_capital: "1880.27", abono_interes: "818.33", total_restante: "52234.65" },
      { pago_id: 144022, numero_cuota: 34, pagado: true, abono_capital: "440.50", total_restante: "52234.65" },
      { pago_id: 10749, numero_cuota: 35, pagado: true, abono_capital: "1919.26", abono_interes: "783.52", total_restante: "47874.89" },
      { pago_id: 150049, numero_cuota: 35, pagado: true, abono_capital: "2440.50", total_restante: "47874.89" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["54555.42", "52675.15", "52234.65", "50315.39", "47874.89"]);
  });

  it("abono puro que llega antes que la cuota regular del mismo mes: saldo corrido real, luego la hermana lo cierra", () => {
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 29, pagado: true, abono_capital: "3456.78", abono_interes: "900.00", total_restante: "62139.83" },
      { pago_id: 3, numero_cuota: 30, pagado: true, abono_capital: "440.50", total_restante: "59946.48" },
      { pago_id: 2, numero_cuota: 30, pagado: true, abono_capital: "1752.85", abono_interes: "850.00", total_restante: "59946.48" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["62139.83", "61699.33", "59946.48"]);
  });

  it("abono agregado DESPUÉS de la sync no desarma a las filas ya netas de la cuota", () => {
    // Saldo Q100; sync escribió Q85 (neto de 10+5) en ambas filas; luego entra
    // un abono de Q2 que hereda el snapshot Q85. Esperado: 85, 85, 83 (no 78).
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 4, pagado: true, abono_capital: "0.00", abono_interes: "1.00", total_restante: "100.00" },
      { pago_id: 2, numero_cuota: 5, pagado: true, abono_capital: "10.00", abono_interes: "1.00", total_restante: "85.00" },
      { pago_id: 3, numero_cuota: 5, pagado: true, abono_capital: "5.00", total_restante: "85.00" },
      { pago_id: 4, numero_cuota: 5, pagado: true, abono_capital: "2.00", total_restante: "85.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["100.00", "85.00", "85.00", "83.00"]);
  });

  it("primera cuota visible sin saldo previo: conserva el snapshot inicial y descuenta el siguiente parcial", () => {
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 35, pagado: true, abono_capital: "600.00", abono_interes: "100.00", total_restante: "49400.00" },
      { pago_id: 2, numero_cuota: 35, pagado: true, abono_capital: "400.00", total_restante: "49400.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["49400.00", "49000.00"]);
  });

  it("muestra el capital corrido de cada pago cuando la cuota comparte el saldo final", () => {
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 50408, numero_cuota: 33, pagado: true, abono_capital: "198.70", total_restante: "25163.02" },
      { pago_id: 137961, numero_cuota: 34, pagado: true, abono_capital: "0.00", abono_interes: "377.45", total_restante: "24418.79" },
      { pago_id: 143511, numero_cuota: 34, pagado: true, abono_capital: "544.53", abono_seguro: "183.67", total_restante: "24418.79" },
      { pago_id: 50409, numero_cuota: 34, pagado: true, abono_capital: "199.70", total_restante: "24418.79" },
      { pago_id: 147279, numero_cuota: 35, pagado: true, abono_capital: "0.00", abono_interes: "366.28", total_restante: "23662.05" },
      { pago_id: 151685, numero_cuota: 35, abono_capital: "407.04", abono_seguro: "171.16", total_restante: "23662.05" },
      { pago_id: 50410, numero_cuota: 35, pagado: true, abono_capital: "349.70", total_restante: "23662.05" },
      { pago_id: 159296, numero_cuota: 36, pagado: true, abono_capital: "0.00", abono_interes: "200.00", total_restante: "22892.60" },
      { pago_id: 159297, numero_cuota: 36, pagado: true, abono_capital: "0.00", abono_interes: "154.93", total_restante: "22892.60" },
      { pago_id: 159777, numero_cuota: 36, pagado: true, abono_capital: "472.75", abono_seguro: "46.45", total_restante: "22892.60" },
    ]);

    expect(rows.map((p) => p.total_restante)).toEqual([
      "25163.02",
      "25163.02",
      "24618.49",
      "24418.79",
      "24418.79",
      "24011.75",
      "23662.05",
      "23662.05",
      "23662.05",
      "23189.30",
    ]);
  });

  it("parcial normal (registerPayment): el cierre solo-capital hereda el saldo de la hermana y SÍ se resta", () => {
    // La 1a parte cubre interés/servicios + parte del capital; el cierre trae solo
    // capital y total_restante = el de la hermana (sin restar su propio capital).
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 10, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 2, numero_cuota: 11, pagado: true, abono_capital: "600.00", abono_interes: "500.00", total_restante: "49400.00" },
      { pago_id: 3, numero_cuota: 11, pagado: true, abono_capital: "400.00", total_restante: "49400.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["50000.00", "49400.00", "49000.00"]);
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
