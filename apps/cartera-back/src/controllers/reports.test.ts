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

  it("mantiene incluidos los pagos parciales aplicados que están marcados como pagados", () => {
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
        numero_cuota: 12,
        pagado: true,
        abono_capital: "1319.93",
        abono_interes: "1767.89",
        total_restante: "116539.07",
      },
      {
        pago_id: 127060,
        numero_cuota: 12,
        abono_capital: "0.00",
        total_restante: "0.00",
      },
      {
        pago_id: 17420,
        numero_cuota: 13,
        pagado: true,
        abono_capital: "1342.11",
        abono_interes: "1748.09",
        total_restante: "115196.94",
      },
      {
        pago_id: 134345,
        numero_cuota: 13,
        abono_capital: "75000.00",
        total_restante: "39720.74",
      },
    ]);

    // La cuota 13 arranca en el cierre guardado de la 12 y baja abono por
    // abono; los 2 centavos vienen del propio descuadre de los datos.
    expect(rows.map((p) => p.total_restante)).toEqual([
      "116539.07",
      "116539.07",
      "115196.96",
      "40196.96",
    ]);
  });

  it("cada cuota cierra en su snapshot aunque la sync repita el saldo en todas sus filas", () => {
    // Crédito 01010214106990, cuota 35: la sync escribe el mismo total_restante
    // (ya neto del abono de Q2,440.50) en ambos pagos de la cuota. El saldo se
    // corre desde la apertura, así que la 1a fila muestra su propio saldo y la
    // última aterriza en el snapshot guardado.
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
    // un abono de Q2 que hereda el snapshot Q85. El saldo baja 10, 5 y 2 desde
    // la apertura Q100 y cierra en Q83, sin restar dos veces.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 4, pagado: true, abono_capital: "0.00", abono_interes: "1.00", total_restante: "100.00" },
      { pago_id: 2, numero_cuota: 5, pagado: true, abono_capital: "10.00", abono_interes: "1.00", total_restante: "85.00" },
      { pago_id: 3, numero_cuota: 5, pagado: true, abono_capital: "5.00", total_restante: "85.00" },
      { pago_id: 4, numero_cuota: 5, pagado: true, abono_capital: "2.00", total_restante: "85.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["100.00", "90.00", "85.00", "83.00"]);
  });

  it("primera cuota visible sin saldo previo: siembra la apertura y corre el saldo", () => {
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 10749, numero_cuota: 35, pagado: true, abono_capital: "1919.26", abono_interes: "783.52", total_restante: "47874.89" },
      { pago_id: 150049, numero_cuota: 35, pagado: true, abono_capital: "2440.50", total_restante: "47874.89" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["50315.39", "47874.89"]);
  });

  it("capital puro en MEDIO de la cuota no hunde el saldo (crédito 872, cuota 33)", () => {
    // Cuatro boletas para una cuota: los rubros se agotan en las dos primeras,
    // así que la 3a queda como capital puro en medio. Antes restaba su abono de
    // un saldo que ya venía neto y el PDF mostraba Q24,662.55 entre dos
    // Q25,162.55; ahora el saldo baja parejo y cierra donde debe.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 50407, numero_cuota: 32, pagado: true, abono_capital: "719.85", abono_interes: "399.22", total_restante: "25894.49" },
      { pago_id: 130230, numero_cuota: 33, pagado: true, abono_capital: "0.00", abono_interes: "388.42", abono_seguro: "260.93", total_restante: "25162.55" },
      { pago_id: 134346, numero_cuota: 33, pagado: true, abono_capital: "33.24", abono_gps: "120.95", membresias_pago: "145.80", total_restante: "25162.55" },
      { pago_id: 135163, numero_cuota: 33, pagado: true, abono_capital: "500.00", total_restante: "25162.55" },
      { pago_id: 50408, numero_cuota: 33, pagado: true, abono_capital: "198.70", total_restante: "25162.55" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "25894.49",
      "25894.49",
      "25861.25",
      "25361.25",
      "25162.55",
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

  it("una cuota de solo capital directo sigue desde el saldo de la cuota 0", () => {
    // registerPayment puede colgar capital directo de una primera cuota que
    // sigue pendiente: su fila regular queda filtrada y solo sobrevive la del
    // capital, que guarda total_restante 0. Sin snapshot propio no hay cierre
    // que reconstruir, pero la apertura sí se conoce —es el saldo de la cuota
    // 0— así que se sigue desde ahí. Antes el crédito arrancaba en Q0.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 0, pagado: true, abono_capital: "0.00", abono_interes: "5.00", total_restante: "100.00" },
      { pago_id: 2, numero_cuota: 1, pagado: true, abono_capital: "10.00", total_restante: "0" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["100.00", "90.00"]);
  });

  it("una cancelacion en 0 confirma el cierre de la cuota anterior", () => {
    // La cuota 2 cancela el crédito y guarda total_restante 0. Ese cero no se
    // toma como snapshot (para que un cero de capital directo no ancle a
    // nadie) pero sí vale como evidencia: la apertura implícita de la 2 es
    // 0 + 49,000, que confirma que la 1 cierra en Q49,000 y no en su Q50,000
    // heredado. Sin esto la cancelación se mostraba en Q1,000.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 0, pagado: true, abono_capital: "0.00", abono_interes: "500.00", total_restante: "50400.00" },
      { pago_id: 2, numero_cuota: 1, pagado: true, abono_capital: "600.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 3, numero_cuota: 1, pagado: true, abono_capital: "400.00", total_restante: "50000.00" },
      { pago_id: 4, numero_cuota: 2, pagado: true, abono_capital: "49000.00", abono_interes: "500.00", total_restante: "0" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "50400.00",
      "49400.00",
      "49000.00",
      "0.00",
    ]);
  });

  it("ultima cuota visible: la anterior confirma su snapshot pre-cierre", () => {
    // La cuota 1 es la última y la cerró registerPayment, así que no hay
    // siguiente que la desempate. La evidencia sale de la cuota 0: su cierre
    // Q50,000 es la apertura de la 1, y solo el candidato Q49,000 más los
    // Q1,000 de abonos cae ahí.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 0, pagado: true, abono_capital: "0.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 2, numero_cuota: 1, pagado: true, abono_capital: "600.00", abono_interes: "500.00", total_restante: "49400.00" },
      { pago_id: 3, numero_cuota: 1, pagado: true, abono_capital: "400.00", total_restante: "49400.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["50000.00", "49400.00", "49000.00"]);
  });

  it("ultima cuota visible: si la anterior no confirma nada, manda su snapshot", () => {
    // Crédito 1085: los abonos no explican la caída del saldo, así que la
    // apertura implícita no cae sobre ningún candidato y la cuota conserva el
    // suyo. Es lo que impide que la cuota 0 termine anclando a la 1.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 60434, numero_cuota: 0, pagado: true, abono_capital: "0.00", abono_interes: "900.00", total_restante: "98908.24" },
      { pago_id: 60435, numero_cuota: 1, pagado: true, abono_capital: "1737.73", abono_interes: "2664.42", total_restante: "95848.01" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["98908.24", "95848.01"]);
  });

  it("un sufijo que cuadra por casualidad no desplaza al snapshot que la siguiente confirma", () => {
    // Cuota sincronizada cuyos abonos (10 + 5) suman más que la baja de su
    // snapshot (100 → 90). El sufijo de Q5 hace cuadrar el saldo corrido Q85,
    // pero la cuota 12 confirma que su apertura es Q90: manda el snapshot.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 10, pagado: true, abono_capital: "0.00", abono_interes: "5.00", total_restante: "100.00" },
      { pago_id: 2, numero_cuota: 11, pagado: true, abono_capital: "10.00", abono_interes: "5.00", total_restante: "90.00" },
      { pago_id: 3, numero_cuota: 11, pagado: true, abono_capital: "5.00", total_restante: "90.00" },
      { pago_id: 4, numero_cuota: 12, pagado: true, abono_capital: "10.00", abono_interes: "5.00", total_restante: "80.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "100.00",
      "90.00",
      "85.00",
      "80.00",
    ]);
  });

  it("varios pagos de capital directo seguidos: el snapshot queda atras por todos ellos", () => {
    // El capital directo se cuelga de la última cuota pagada y guarda
    // total_restante 0, así que el snapshot de la cuota se queda en una fila
    // anterior. Con dos pagos seguidos (Q400 y Q300) el snapshot Q50,000 está
    // Q700 atrás del cierre real Q49,300, no solo Q300.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 0, numero_cuota: 9, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "51000.00" },
      { pago_id: 1, numero_cuota: 10, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 2, numero_cuota: 10, pagado: true, abono_capital: "400.00", total_restante: "0" },
      { pago_id: 3, numero_cuota: 10, pagado: true, abono_capital: "300.00", total_restante: "0" },
      { pago_id: 4, numero_cuota: 11, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "48300.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "51000.00",
      "50000.00",
      "49600.00",
      "49300.00",
      "48300.00",
    ]);
  });

  it("varios capitales directos en la cuota que siembra la cadena", () => {
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 10, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 2, numero_cuota: 10, pagado: true, abono_capital: "400.00", total_restante: "0" },
      { pago_id: 3, numero_cuota: 10, pagado: true, abono_capital: "300.00", total_restante: "0" },
      { pago_id: 4, numero_cuota: 11, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "48300.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "50000.00",
      "49600.00",
      "49300.00",
      "48300.00",
    ]);
  });

  it("la cuota que siembra la cadena reconoce su snapshot pre-cierre por la siguiente", () => {
    // Con la cuota 0 presente, la cuota 1 siembra la cadena y no tiene una
    // anterior contra la cual reconocer que su snapshot es pre-cierre. La
    // evidencia sale de la cuota 2: su apertura implícita (48,000 + 1,000) cae
    // exacto en 49,000, o sea que el cierre real de la 1 es ese y no 49,400.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 0, pagado: true, abono_capital: "0.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 2, numero_cuota: 1, pagado: true, abono_capital: "600.00", abono_interes: "500.00", total_restante: "49400.00" },
      { pago_id: 3, numero_cuota: 1, pagado: true, abono_capital: "400.00", total_restante: "49400.00" },
      { pago_id: 4, numero_cuota: 2, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "48000.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "50000.00",
      "49400.00",
      "49000.00",
      "48000.00",
    ]);
  });

  it("la cuota que siembra respeta su snapshot cuando los abonos no explican la caida", () => {
    // Crédito 1085: el saldo baja ~Q3,112 por cuota pero el capital registrado
    // es ~Q1,767. La apertura implícita de la cuota 2 no cae sobre ninguno de
    // los dos candidatos de la 1, así que manda su snapshot guardado.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 60434, numero_cuota: 0, pagado: true, abono_capital: "0.00", abono_interes: "900.00", total_restante: "98908.24" },
      { pago_id: 60435, numero_cuota: 1, pagado: true, abono_capital: "1737.73", abono_interes: "2664.42", total_restante: "95848.01" },
      { pago_id: 60436, numero_cuota: 2, pagado: true, abono_capital: "1766.93", abono_interes: "2638.35", total_restante: "92736.38" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual(["98908.24", "95848.01", "94081.08"]);
  });

  it("el cierre por registerPayment no arrastra su saldo heredado a la cuota siguiente", () => {
    // La cuota 11 guarda Q49,400 en sus dos filas (el cierre solo-capital
    // hereda el total_restante de su hermana sin restar su propio abono), pero
    // su cierre real es Q49,000. Anclar la cuota 12 en el snapshot la dejaría
    // Q400 arriba en todas sus filas.
    const rows = applyEstadoCuentaRunningCapital([
      { pago_id: 1, numero_cuota: 10, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "50000.00" },
      { pago_id: 2, numero_cuota: 11, pagado: true, abono_capital: "600.00", abono_interes: "500.00", total_restante: "49400.00" },
      { pago_id: 3, numero_cuota: 11, pagado: true, abono_capital: "400.00", total_restante: "49400.00" },
      { pago_id: 4, numero_cuota: 12, pagado: true, abono_capital: "1000.00", abono_interes: "500.00", total_restante: "48000.00" },
    ]);
    expect(rows.map((p) => p.total_restante)).toEqual([
      "50000.00",
      "49400.00",
      "49000.00",
      "48000.00",
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
