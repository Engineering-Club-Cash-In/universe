import { describe, expect, test } from "bun:test";
import {
  assertModeReconciliation,
  buildInvestorPosition,
  buildNetInterestDetail,
  getPublicReinvestmentDetailError,
  assertReportReconciliation,
} from "./reinvestmentReport";

describe("buildNetInterestDetail", () => {
  test("con factura suma IVA al interés", () => {
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
      tratamiento_fiscal: "con_factura",
      interes: "100.00",
      iva: "12.00",
      isr: "0.00",
      neto: "112.00",
    });
  });

  test("sin factura resta ISR y no incorpora el IVA informativo", () => {
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
      tratamiento_fiscal: "sin_factura",
      interes: "100.00",
      iva: "0.00",
      isr: "7.00",
      neto: "93.00",
    });
  });
});

describe("buildInvestorPosition", () => {
  test("capital activo suma monto posterior y reinversión", () => {
    expect(buildInvestorPosition(770_924.47, 29_075.53, false)).toEqual({
      monto_aportado: "770924.47",
      capital_activo: "800000.00",
    });
  });

  test("mayo 2026 normaliza el histórico sin duplicar la reinversión", () => {
    expect(buildInvestorPosition(800_000, 29_075.53, true)).toEqual({
      monto_aportado: "770924.47",
      capital_activo: "800000.00",
    });
  });
});

test("respuesta completa concilia los tres detalles y no duplica CUBE", () => {
  const response = {
    interesNeto: {
      conFactura: { neto: "112.00" },
      sinFactura: { neto: "93.00" },
      cube: { neto: "22.40" },
    },
    pagosExtras: { abonos_capital: "30.00", cancelaciones: "70.00" },
    comprasMes: [
      { tipo: "sin_reinversion", cantidad: 1, monto: "80.00" },
      { tipo: "reinversion_capital", cantidad: 1, monto: "20.00" },
    ],
    detalleInteresNeto: [
      { tratamiento_fiscal: "con_factura", neto: "112.00" },
      { tratamiento_fiscal: "sin_factura", neto: "93.00" },
      { tratamiento_fiscal: "cube", neto: "22.40" },
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
        conFactura: { neto: "0.00" },
        sinFactura: { neto: "0.00" },
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
    source.indexOf("const comprasMes = ("),
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
        conFactura: { neto: "0.00" },
        sinFactura: { neto: "0.00" },
        cube: { neto: "22.40" },
      },
      pagosExtras: { abonos_capital: "0.00", cancelaciones: "0.00" },
      comprasMes: [],
      detalleInteresNeto: [
        { tratamiento_fiscal: "cube", neto: "22.40" },
        { tratamiento_fiscal: "cube", neto: "22.40" },
      ],
      detallePagosExtras: [],
      detalleComprasMes: [],
    }),
  ).toThrow("Detalle de interés neto no concilia");
});

test("cada clase de descuadre impide publicar una respuesta completa", () => {
  const valid = {
    interesNeto: {
      conFactura: { neto: "112.00" },
      sinFactura: { neto: "93.00" },
      cube: { neto: "22.40" },
    },
    pagosExtras: { abonos_capital: "30.00", cancelaciones: "70.00" },
    comprasMes: [
      { tipo: "sin_reinversion", cantidad: 1, monto: "100.00" },
    ],
    detalleInteresNeto: [
      { tratamiento_fiscal: "con_factura", neto: "112.00" },
      { tratamiento_fiscal: "sin_factura", neto: "93.00" },
      { tratamiento_fiscal: "cube", neto: "22.40" },
    ],
    detallePagosExtras: [{ tipo: "abono_capital", monto: "30.00" }, { tipo: "cancelacion", monto: "70.00" }],
    detalleComprasMes: [{ modalidad: "sin_reinversion", monto: "100.00" }],
  };

  expect(() =>
    assertReportReconciliation({
      ...valid,
      detalleInteresNeto: valid.detalleInteresNeto.map((row, index) =>
        index === 0 ? { ...row, neto: "111.99" } : row,
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
      conFactura: { neto: "112.00" },
      sinFactura: { neto: "93.00" },
      cube: { neto: "0.00" },
    },
    pagosExtras: { abonos_capital: "30.00", cancelaciones: "70.00" },
    comprasMes: [
      { tipo: "sin_reinversion", cantidad: 1, monto: "80.00" },
      { tipo: "reinversion_capital", cantidad: 1, monto: "20.00" },
    ],
    detalleInteresNeto: [
      { tratamiento_fiscal: "con_factura", neto: "111.00" },
      { tratamiento_fiscal: "sin_factura", neto: "94.00" },
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
        { tratamiento_fiscal: "con_factura", neto: "112.00" },
        { tratamiento_fiscal: "sin_factura", neto: "93.00" },
      ],
    }),
  ).toThrow("Detalle de pagos extras no concilia");
  expect(() =>
    assertReportReconciliation({
      ...base,
      detalleInteresNeto: [
        { tratamiento_fiscal: "con_factura", neto: "112.00" },
        { tratamiento_fiscal: "sin_factura", neto: "93.00" },
      ],
      detallePagosExtras: [
        { tipo: "abono_capital", monto: "30.00" },
        { tipo: "cancelacion", monto: "70.00" },
      ],
    }),
  ).toThrow("Detalle de compras del mes no concilia");
});

test("cada modalidad concilia destinos y composición fiscal real", () => {
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
    }),
  ).toBe(true);
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
