import { describe, expect, test } from "bun:test";
import {
  allocateRoundedAmounts,
  allocateRoundedPurchaseAmounts,
  assertModeReconciliation,
  assertReportReconciliation,
  buildCubeNetInterest,
  canonicalizePurchaseSummaries,
  buildNetInterestDetail,
  getPublicReinvestmentDetailError,
  shouldIncludeInvestorPosition,
} from "./reinvestmentReport";

test("CUBE deriva el neto de los componentes redondeados", () => {
  expect(buildCubeNetInterest(1.00447)).toEqual({
    interes: "1.00",
    iva: "0.12",
    neto: "1.12",
  });
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

test("capital activo usa el espejo completo y excluye créditos cerrados", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();
  const activeCapitalQuery = source.slice(
    source.indexOf("const capitalActivoRows"),
    source.indexOf("const montoAportadoRows"),
  );

  expect(activeCapitalQuery).toContain(
    "FROM cartera.creditos_inversionistas_espejo ce",
  );
  expect(activeCapitalQuery).toContain(
    "cr.\"statusCredit\" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')",
  );
  expect(activeCapitalQuery).toContain("GROUP BY ce.inversionista_id");
});

test("el resumen de compras canoniza NULL y sin_reinversion en la misma modalidad", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();
  const purchasesQuery = source.slice(
    source.indexOf("const comprasRows"),
    source.indexOf("let detalleInteresNeto"),
  );

  expect(purchasesQuery).toContain(
    "GROUP BY COALESCE(c.tipo_reinversion::text, 'sin_reinversion')",
  );
});

test("compras legacy NULL y sin_reinversion se agregan bajo una sola llave pública", () => {
  expect(canonicalizePurchaseSummaries([
    { tipo: null, cantidad: 1, monto: "10.00" },
    { tipo: "sin_reinversion", cantidad: 2, monto: "20.00" },
  ])).toEqual([{ tipo: "sin_reinversion", cantidad: 3, monto: "30.00" }]);
});

test("el contrato v2 no publica monto_aportado histórico incorrecto", async () => {
  const source = await Bun.file(
    new URL("./reportes.ts", import.meta.url),
  ).text();

  expect(source).not.toContain("const montoAportadoRows");
  expect(source).not.toContain("monto_aportado: Number");
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
