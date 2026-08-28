import { describe, expect, test } from "bun:test";
import {
  allocateRoundedAmounts,
  allocateRoundedPurchaseAmounts,
  assertModeReconciliation,
  assertReportReconciliation,
  buildLiquidationComposition,
  buildPurchaseTicketHistory,
  calculateActiveCapital,
  buildCubeNetInterest,
  canonicalizeLiquidationModeRows,
  canonicalizePurchaseSummaries,
  buildNetInterestDetail,
  getPublicReinvestmentDetailError,
  summarizePurchaseDetails,
  shouldIncludeInvestorPosition,
} from "./reinvestmentReport";

test("CUBE deriva el neto de los componentes redondeados", () => {
  expect(buildCubeNetInterest(1.00447)).toEqual({
    interes: "1.00",
    iva: "0.12",
    neto: "1.12",
  });
});

test("CUBE conserva centavos antes de calcular IVA para montos numeric grandes", () => {
  expect(buildCubeNetInterest("900719925474000.91")).toEqual({
    interes: "900719925474000.91",
    iva: "108086391056880.11",
    neto: "1008806316530881.02",
  });
});

test("asigna una sola vez el residuo de centavo entre modalidades", () => {
  const rows = canonicalizeLiquidationModeRows([
    {
      tipo: "reinversion_variable",
      reinversion_capital: "0",
      reinversion_interes: "0",
      reinversion_total: "0.005",
      total_capital: "0.005",
      total_interes: "0",
      total_iva: "0",
      total_isr: "0",
      total_distribuido: "0.005",
    },
    {
      tipo: "sin_reinversion",
      reinversion_capital: "0",
      reinversion_interes: "0",
      reinversion_total: "0.005",
      total_capital: "0.005",
      total_interes: "0",
      total_iva: "0",
      total_isr: "0",
      total_distribuido: "0.005",
    },
  ]);

  expect(rows.map((row) => row.total_capital).sort()).toEqual(["0.00", "0.01"]);
  expect(rows.map((row) => row.total_distribuido).sort()).toEqual(["0.00", "0.01"]);
  expect(rows.map((row) => row.reinversion_total).sort()).toEqual(["0.00", "0.01"]);
  expect(rows.map((row) => row.total_cuota)).toEqual(["0.00", "0.00"]);
});

test("distribuye el centavo residual sin cambiar el orden de los pagos", () => {
  const amounts = allocateRoundedAmounts([
    "33.333333",
    "33.333333",
    "33.333333",
  ]);

  expect(amounts).toEqual(["33.34", "33.33", "33.33"]);
  expect(
    assertReportReconciliation({
      interesNeto: {
        noVerificado: { interes: "0.00" },
        cube: { neto: "0.00" },
      },
      pagosExtras: { abonos_capital: "100.00", cancelaciones: "0.00" },
      comprasMes: [],
      detalleInteresNeto: [],
      detallePagosExtras: amounts.map((monto) => ({
        tipo: "abono_capital",
        monto,
      })),
      detalleComprasMes: [],
    }),
  ).toMatchObject({ pagosExtras: true });
});

test("distribuye numeric grandes sin desbordar el residuo en Number", () => {
  expect(
    allocateRoundedAmounts(["900719925474000.901", "0.009"]),
  ).toEqual(["900719925474000.90", "0.01"]);
});

test("distribuye residuos de compras por modalidad sin cambiar cantidad ni orden", () => {
  const purchases = allocateRoundedPurchaseAmounts([
    { modalidad: "sin_reinversion", referencia: "A", monto: "33.333333" },
    { modalidad: "reinversion_capital", referencia: "B", monto: "10.005" },
    { modalidad: "sin_reinversion", referencia: "C", monto: "33.333333" },
    { modalidad: "reinversion_capital", referencia: "D", monto: "10.005" },
    { modalidad: "sin_reinversion", referencia: "E", monto: "33.333333" },
  ]);

  expect(purchases.map((row) => row.referencia)).toEqual(["A", "B", "C", "D", "E"]);
  expect(purchases.map((row) => row.monto)).toEqual([
    "33.34",
    "10.00",
    "33.33",
    "10.01",
    "33.33",
  ]);
  expect(purchases).toHaveLength(5);
  expect(
    assertReportReconciliation({
      interesNeto: {
        noVerificado: { interes: "0.00" },
        cube: { neto: "0.00" },
      },
      pagosExtras: { abonos_capital: "0.00", cancelaciones: "0.00" },
      comprasMes: [
        { tipo: "sin_reinversion", cantidad: 3, monto: "100.00" },
        { tipo: "reinversion_capital", cantidad: 2, monto: "20.01" },
      ],
      detalleInteresNeto: [],
      detallePagosExtras: [],
      detalleComprasMes: purchases,
    }),
  ).toMatchObject({ comprasMes: true });
});

describe("buildNetInterestDetail", () => {
  test("sin evidencia fiscal conserva IVA e ISR registrados sin publicar neto", () => {
    expect(
      buildNetInterestDetail({
        inversionista_id: 1,
        inversionista: "Ana",
        referencia: "LIQ-1",
        interes: 100,
        iva: 12,
        isr: 0,
      }),
    ).toMatchObject({
      tratamiento_fiscal: "no_verificado",
      interes: "100.00",
      iva: "12.00",
      isr: "0.00",
    });
  });

test("ISR registrado no se convierte en neto fiscal", () => {
    expect(
      buildNetInterestDetail({
        inversionista_id: 2,
        inversionista: "Luis",
        referencia: "LIQ-2",
        interes: 100,
        iva: 12,
        isr: 7,
      }),
    ).toMatchObject({
      tratamiento_fiscal: "no_verificado",
      interes: "100.00",
      iva: "12.00",
      isr: "7.00",
    });
  });
});

test("interés con ISR positivo que redondea a cero no infiere factura ni IVA", () => {
  expect(
    buildNetInterestDetail({
      inversionista_id: 3,
      inversionista: "Marta",
      referencia: "LIQ-3",
      interes: 0.05,
      iva: 0.01,
      isr: 0.0035,
    }),
  ).toMatchObject({
    tratamiento_fiscal: "no_verificado",
    interes: "0.05",
    iva: "0.01",
    isr: "0.00",
  });
});

test("el reporte conserva y totaliza al inversionista con capital activo y flujo cero", () => {
  const investor = {
    reinversion: "0.00",
    a_recibir: "0.00",
    capital_activo: "1250.00",
  };
  const retained = [investor].filter(shouldIncludeInvestorPosition);

  expect(retained).toEqual([investor]);
  expect(
    retained.reduce(
      (total, investor) => total + Number(investor.capital_activo),
      0,
    ),
  ).toBe(1250);
});

test("capital activo conserva la posición aceptada al restar una compra pendiente", () => {
  expect(calculateActiveCapital(1250, 250)).toBe("1000.00");
});

test("capital activo resta múltiples compras pendientes ya agregadas", () => {
  expect(calculateActiveCapital(1250, 250 + 100)).toBe("900.00");
});

test("capital activo no resta compras completadas", () => {
  expect(calculateActiveCapital(1250, 0)).toBe("1250.00");
});

test("capital activo resta numeric sin perder precisión antes de redondear", () => {
  expect(calculateActiveCapital("90071992547409.91", "0.01")).toBe(
    "90071992547409.90",
  );
});

test("separa capital y resto cuando la composición liquidada es completa", () => {
  expect(buildLiquidationComposition({
    totalCapital: "90.00",
    paidTotal: "35.00",
    reinvestedCapital: "60.00",
    reinvestedRest: "5.00",
    reinvestedTotal: "65.00",
  })).toEqual({
    pagado: { capital: "30.00", resto: "5.00", sin_clasificar: "0.00", total: "35.00" },
    reinvertido: { capital: "60.00", resto: "5.00", sin_clasificar: "0.00", total: "65.00" },
    flujo: { capital: "90.00", resto: "10.00", total: "100.00" },
    estado: "exacto",
  });
});

test("no inventa el destino capital/resto cuando falta composición de reinversión", () => {
  expect(buildLiquidationComposition({
    totalCapital: "80.00",
    paidTotal: "40.00",
    reinvestedCapital: "10.00",
    reinvestedRest: "5.00",
    reinvestedTotal: "60.00",
  })).toEqual({
    pagado: { capital: "0.00", resto: "0.00", sin_clasificar: "40.00", total: "40.00" },
    reinvertido: { capital: "10.00", resto: "5.00", sin_clasificar: "45.00", total: "60.00" },
    flujo: { capital: "80.00", resto: "20.00", total: "100.00" },
    estado: "sin_clasificar",
  });
});

test("resume compras por modalidad de facturación, tipo de reinversión y clasificación", () => {
  expect(summarizePurchaseDetails([
    {
      modalidad_facturacion: "interes_mas_iva",
      tipo_reinversion: "reinversion_capital",
      tipo_compra: "nueva_posicion",
      monto: "10.005",
    },
    {
      modalidad_facturacion: "interes_mas_iva",
      tipo_reinversion: "reinversion_capital",
      tipo_compra: "nueva_posicion",
      monto: "20.005",
    },
    {
      modalidad_facturacion: "sin_modalidad",
      tipo_reinversion: "sin_reinversion",
      tipo_compra: "sin_clasificar",
      monto: "7.00",
    },
  ])).toEqual([
    {
      modalidad_facturacion: "interes_mas_iva",
      tipo_reinversion: "reinversion_capital",
      tipo_compra: "nueva_posicion",
      cantidad: 2,
      monto: "30.01",
    },
    {
      modalidad_facturacion: "sin_modalidad",
      tipo_reinversion: "sin_reinversion",
      tipo_compra: "sin_clasificar",
      cantidad: 1,
      monto: "7.00",
    },
  ]);
});

test("ticket histórico usa solo nuevas posiciones y compara el mes calendario anterior", () => {
  expect(buildPurchaseTicketHistory([
    { periodo: "2026-06", tipo_compra: "nueva_posicion", monto: "100.00", cantidad: 2 },
    { periodo: "2026-07", tipo_compra: "nueva_posicion", monto: "100.00" },
    { periodo: "2026-07", tipo_compra: "ampliacion_posicion", monto: "900.00" },
    { periodo: "2026-08", tipo_compra: "nueva_posicion", monto: "100.00" },
    { periodo: "2026-08", tipo_compra: "nueva_posicion", monto: "200.00" },
    { periodo: "2026-08", tipo_compra: "sin_clasificar", monto: "1000.00" },
  ], "2026-08")).toEqual({
    actual: {
      periodo: "2026-08",
      cantidad: 2,
      monto_total: "300.00",
      ticket_promedio: "150.00",
      variacion_porcentual: "50.00",
    },
    historico: [
      { periodo: "2026-06", cantidad: 2, monto_total: "100.00", ticket_promedio: "50.00" },
      { periodo: "2026-07", cantidad: 1, monto_total: "100.00", ticket_promedio: "100.00" },
      { periodo: "2026-08", cantidad: 2, monto_total: "300.00", ticket_promedio: "150.00" },
    ],
  });
});

test("reporte agrupa liquidaciones por snapshot y publica legacy como sin clasificar", async () => {
  const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();
  const report = source.slice(
    source.indexOf("export async function getReinversionLiquidaciones"),
  );

  expect(report).toContain("l.tipo_reinversion_snapshot");
  expect(report).toContain("cartera.historico_liquidaciones_espejo");
  expect(report).toContain("cartera.pagos_credito_inversionistas_espejo");
  expect(report).toContain("reinversion_residual");
  expect(report).toContain("COUNT(DISTINCT f.liquidacion_id)");
  expect(report).toContain("'sin_clasificar'");
  expect(report).not.toContain("GROUP BY i.tipo_reinversion");
});

test("capital activo agrega compras pendientes por posición antes de restarlas", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();
  const activeCapitalStart = source.indexOf("const capitalActivoRows");
  const activeCapitalQuery = source.slice(
    activeCapitalStart,
    source.indexOf("const porInversionista", activeCapitalStart),
  );

  expect(activeCapitalQuery).toContain("WITH pending_purchase_deltas AS");
  expect(activeCapitalQuery).toContain("c.tipo_operacion = 'compra_cartera'");
  expect(activeCapitalQuery).toContain("c.status = 'pendiente_compra_cartera'");
  expect(activeCapitalQuery).toContain(
    "GROUP BY c.credito_id, c.inversionista_id",
  );
  expect(activeCapitalQuery).toContain(
    "SUM(ce.monto_aportado::numeric), 0) AS monto_espejo",
  );
  expect(activeCapitalQuery).toContain(
    "SUM(ppd.monto_pendiente), 0) AS monto_compra_pendiente",
  );
  expect(activeCapitalQuery).toContain(
    "FROM cartera.creditos_inversionistas_espejo ce",
  );
  expect(activeCapitalQuery).toContain(
    "cr.\"statusCredit\" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')",
  );
  expect(activeCapitalQuery).toContain("GROUP BY ce.inversionista_id");
  expect(activeCapitalQuery).toContain(
    "calculateActiveCapital(\n        String(r.monto_espejo ?? 0),\n        String(r.monto_compra_pendiente ?? 0)",
  );
});

test("el resumen de compras usa modalidad de facturación y conserva tipo de reinversión", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();
  const purchasesQuery = source.slice(
    source.indexOf("const comprasRows"),
    source.indexOf("let detalleInteresNeto"),
  );

  expect(purchasesQuery).toContain(
    "COALESCE(c.modalidad_facturacion::text, 'sin_modalidad') AS modalidad_facturacion",
  );
  expect(purchasesQuery).toContain(
    "COALESCE(c.tipo_reinversion::text, 'sin_reinversion') AS tipo_reinversion",
  );
  expect(purchasesQuery).toContain("c.tipo_compra::text AS tipo_compra");
});

test("compras legacy NULL y sin_reinversion se agregan bajo una sola llave pública", () => {
  expect(canonicalizePurchaseSummaries([
    { tipo: null, cantidad: 1, monto: "10.00" },
    { tipo: "sin_reinversion", cantidad: 2, monto: "20.00" },
  ])).toEqual([{ tipo: "sin_reinversion", cantidad: 3, monto: "30.00" }]);
});

test("resumen de compras suma numeric grandes sin perder centavos", () => {
  expect(canonicalizePurchaseSummaries([
    { tipo: "sin_reinversion", cantidad: 1, monto: "900719925474000.91" },
    { tipo: "sin_reinversion", cantidad: 1, monto: "0.01" },
  ])).toEqual([
    { tipo: "sin_reinversion", cantidad: 2, monto: "900719925474000.92" },
  ]);
});

test("el contrato v2 no publica monto_aportado histórico incorrecto", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();

  expect(source).not.toContain("const montoAportadoRows");
  expect(source).not.toContain("monto_aportado: Number");
});

test("peso de flujo mixto usa capital más interés neto con IVA o ISR", async () => {
  const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();
  const query = source.slice(
    source.indexOf("pesos_mixtos AS"),
    source.indexOf("pesos AS"),
  );

  expect(query).toContain("pe.abono_iva_12::numeric");
  expect(query).toContain("l.descuenta_impuestos = true OR l.total_isr::numeric > 0");
  expect(query).toContain("-(pe.abono_interes::numeric * 0.07)");
});

test("consulta de interés no deja una coma antes de FROM", async () => {
  const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();
  const query = source.slice(
    source.indexOf("const facturaRows"),
    source.indexOf("let interesNoVerificado"),
  );

  expect(query).not.toContain("AS total_interes,\n    FROM");
});

test("respuesta completa concilia los tres detalles y no duplica CUBE", () => {
  const response = {
    interesNeto: {
      noVerificado: { interes: "205.00" },
      cube: { neto: "22.40" },
    },
    pagosExtras: { abonos_capital: "30.00", cancelaciones: "70.00" },
    comprasMes: [
      { tipo: "sin_reinversion", cantidad: 1, monto: "80.00" },
      { tipo: "reinversion_capital", cantidad: 1, monto: "20.00" },
    ],
    detalleInteresNeto: [
      { tratamiento_fiscal: "no_verificado" as const, interes: "112.00", iva: "0.00", isr: "0.00" },
      { tratamiento_fiscal: "no_verificado" as const, interes: "93.00", iva: "0.00", isr: "0.00" },
      { tratamiento_fiscal: "cube" as const, interes: "20.00", iva: "2.40", isr: "0.00", neto: "22.40" },
    ],
    detallePagosExtras: [
      { tipo: "abono_capital", monto: "30.00" },
      { tipo: "cancelacion", monto: "70.00" },
    ],
    detalleComprasMes: [
      { modalidad: "sin_reinversion", monto: "80.00" },
      { modalidad: "reinversion_capital", monto: "20.00" },
    ],
  };

  expect(assertReportReconciliation(response)).toEqual({
    interesNeto: true,
    pagosExtras: true,
    comprasMes: true,
  });
});

test("dos compras del mismo inversionista, fecha y modalidad cuentan como dos operaciones", () => {
  expect(
    assertReportReconciliation({
      interesNeto: {
        noVerificado: { interes: "0.00" },
        cube: { neto: "0.00" },
      },
      pagosExtras: { abonos_capital: "0.00", cancelaciones: "0.00" },
      comprasMes: [
        { tipo: "sin_reinversion", cantidad: 2, monto: "80.00" },
      ],
      detalleInteresNeto: [],
      detallePagosExtras: [],
      detalleComprasMes: [
        {
          fecha: "2026-07-03",
          inversionista: "Ana",
          modalidad: "sin_reinversion",
          monto: "40.00",
        },
        {
          fecha: "2026-07-03",
          inversionista: "Ana",
          modalidad: "sin_reinversion",
          monto: "40.00",
        },
      ],
    }),
  ).toMatchObject({ comprasMes: true });
});

test("el resumen de compras cuenta filas de operación con la misma granularidad del detalle", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();
  const purchasesQuery = source.slice(
    source.indexOf("const comprasRows"),
    source.indexOf("let detalleInteresNeto"),
  );

  expect(purchasesQuery).toContain("COUNT(*)::int AS cantidad");
  expect(purchasesQuery).not.toContain("COUNT(DISTINCT");
});

test("resumen y detalle de compras reutilizan exactamente el mismo predicado canónico", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();
  const canonicalPredicateUses = source.match(
    /WHERE \$\{comprasMesPredicate\}/g,
  );

  expect(source).toContain("const comprasMesPredicate = sql`");
  expect(canonicalPredicateUses).toHaveLength(2);
});

test("respuesta completa rechaza CUBE duplicado o cualquier detalle descuadrado", () => {
  expect(() =>
    assertReportReconciliation({
      interesNeto: {
        noVerificado: { interes: "0.00" },
        cube: { neto: "22.40" },
      },
      pagosExtras: { abonos_capital: "0.00", cancelaciones: "0.00" },
      comprasMes: [],
      detalleInteresNeto: [
        { tratamiento_fiscal: "cube" as const, interes: "20.00", iva: "2.40", isr: "0.00", neto: "22.40" },
        { tratamiento_fiscal: "cube" as const, interes: "20.00", iva: "2.40", isr: "0.00", neto: "22.40" },
      ],
      detallePagosExtras: [],
      detalleComprasMes: [],
    }),
  ).toThrow("Detalle de interés neto no concilia");
});

test("cada clase de descuadre impide publicar una respuesta completa", () => {
  const valid = {
    interesNeto: {
      noVerificado: { interes: "205.00" },
      cube: { neto: "22.40" },
    },
    pagosExtras: { abonos_capital: "30.00", cancelaciones: "70.00" },
    comprasMes: [
      { tipo: "sin_reinversion", cantidad: 1, monto: "100.00" },
    ],
    detalleInteresNeto: [
      { tratamiento_fiscal: "no_verificado" as const, interes: "112.00", iva: "0.00", isr: "0.00" },
      { tratamiento_fiscal: "no_verificado" as const, interes: "93.00", iva: "0.00", isr: "0.00" },
      { tratamiento_fiscal: "cube" as const, interes: "20.00", iva: "2.40", isr: "0.00", neto: "22.40" },
    ],
    detallePagosExtras: [{ tipo: "abono_capital", monto: "30.00" }, { tipo: "cancelacion", monto: "70.00" }],
    detalleComprasMes: [{ modalidad: "sin_reinversion", monto: "100.00" }],
  };

  expect(() =>
    assertReportReconciliation({
      ...valid,
      detalleInteresNeto: valid.detalleInteresNeto.map((row, index) =>
        index === 0 ? { ...row, interes: "111.99" } : row,
      ),
    }),
  ).toThrow("Detalle de interés neto no concilia");
  expect(() =>
    assertReportReconciliation({
      ...valid,
      detallePagosExtras: [
        { tipo: "abono_capital", monto: "29.99" },
        { tipo: "cancelacion", monto: "70.00" },
      ],
    }),
  ).toThrow("Detalle de pagos extras no concilia");
  expect(() =>
    assertReportReconciliation({
      ...valid,
      detalleComprasMes: [
        { modalidad: "sin_reinversion", monto: "99.99" },
      ],
    }),
  ).toThrow("Detalle de compras del mes no concilia");
});

test("los subresúmenes no permiten descuadres compensados entre categorías", () => {
  const base = {
    interesNeto: {
      noVerificado: { interes: "205.00" },
      cube: { neto: "0.00" },
    },
    pagosExtras: { abonos_capital: "30.00", cancelaciones: "70.00" },
    comprasMes: [
      { tipo: "sin_reinversion", cantidad: 1, monto: "80.00" },
      { tipo: "reinversion_capital", cantidad: 1, monto: "20.00" },
    ],
    detalleInteresNeto: [
      { tratamiento_fiscal: "no_verificado" as const, interes: "204.00", iva: "0.00", isr: "0.00" },
    ],
    detallePagosExtras: [
      { tipo: "abono_capital", monto: "29.00" },
      { tipo: "cancelacion", monto: "71.00" },
    ],
    detalleComprasMes: [
      { modalidad: "sin_reinversion", monto: "79.00" },
      { modalidad: "reinversion_capital", monto: "21.00" },
    ],
  };

  expect(() => assertReportReconciliation(base)).toThrow(
    "Detalle de interés neto no concilia",
  );
  expect(() =>
    assertReportReconciliation({
      ...base,
      detalleInteresNeto: [
        { tratamiento_fiscal: "no_verificado" as const, interes: "205.00", iva: "0.00", isr: "0.00" },
      ],
    }),
  ).toThrow("Detalle de pagos extras no concilia");
  expect(() =>
    assertReportReconciliation({
      ...base,
      detalleInteresNeto: [
        { tratamiento_fiscal: "no_verificado" as const, interes: "205.00", iva: "0.00", isr: "0.00" },
      ],
      detallePagosExtras: [
        { tipo: "abono_capital", monto: "30.00" },
        { tipo: "cancelacion", monto: "70.00" },
      ],
    }),
  ).toThrow("Detalle de compras del mes no concilia");
});

test("cada modalidad concilia destinos sin afirmar composición fiscal", () => {
  expect(
    assertModeReconciliation({
      reinversion_capital: "50.00",
      reinversion_interes: "0.00",
      reinversion_total: "50.00",
      total_capital: "50.00",
      total_interes: "5.00",
      iva_facturado: "0.00",
      total_isr: "0.35",
      total_cuota: "4.65",
      total_distribuido: "54.65",
      cantidad_liquidaciones: 1,
    }),
  ).toBe(true);
});

test("una modalidad admite el redondeo acumulado de sus liquidaciones", () => {
  expect(
    assertModeReconciliation({
      reinversion_capital: "34.27",
      reinversion_interes: "0.00",
      reinversion_total: "34.27",
      total_capital: "33.35",
      total_interes: "1.01",
      iva_facturado: "0.00",
      total_isr: "0.07",
      total_cuota: "0.00",
      total_distribuido: "34.27",
      cantidad_liquidaciones: 2,
    }),
  ).toBe(true);

  expect(assertModeReconciliation({
    reinversion_capital: "34.27", reinversion_interes: "0.00",
    reinversion_total: "34.27", total_capital: "33.36", total_interes: "1.01",
    iva_facturado: "0.00", total_isr: "0.07", total_cuota: "0.00",
    total_distribuido: "34.27", cantidad_liquidaciones: 2,
  })).toBe(true);
});

test("una modalidad con composición o destinos descuadrados no se publica", () => {
  const base = {
    reinversion_capital: "50.00",
    reinversion_interes: "0.00",
    reinversion_total: "50.00",
    total_capital: "50.00",
    total_interes: "5.00",
    iva_facturado: "0.00",
    total_isr: "0.35",
    total_cuota: "4.65",
    total_distribuido: "54.65",
    cantidad_liquidaciones: 1,
  };
  expect(() =>
    assertModeReconciliation({ ...base, total_distribuido: "54.64" }),
  ).toThrow("Modalidad no concilia");
  expect(() =>
    assertModeReconciliation({ ...base, total_cuota: "4.64" }),
  ).toThrow("Modalidad no concilia");
});

test("el contrato parcial no devuelve mensajes técnicos del error", () => {
  const secret =
    'relation "cartera.liquidaciones" does not exist at 10.0.0.8:5432';
  const message = getPublicReinvestmentDetailError(new Error(secret));
  expect(message).toBe(
    "Los detalles no están disponibles para este período. Intenta nuevamente más tarde.",
  );
  expect(message).not.toContain("cartera.liquidaciones");
  expect(message).not.toContain("10.0.0.8");
});
