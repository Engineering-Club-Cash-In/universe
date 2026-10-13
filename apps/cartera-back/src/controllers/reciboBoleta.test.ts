import { describe, expect, mock, test } from "bun:test";

mock.module("../database", () => ({ db: {}, client: {} }));
const { resumirBoleta } = await import("./reciboBoleta");

const fila = (pago_id: number, numero_cuota: number, extra: Record<string, unknown> = {}) => ({
  pago_id,
  validation_status: "validated",
  payment_false: false,
  cuota_pagada: true,
  monto_aplicado: "0",
  mora: "0",
  otros: "0",
  numero_cuota,
  ...extra,
});

describe("resumirBoleta", () => {
  test("una boleta de dos cuotas es un solo recibo con lo aplicado sumado", () => {
    // Caso real de PROD: boleta de Q3,830 en las cuotas 18 y 19 del crédito 112.
    const r = resumirBoleta([
      fila(169567, 19, { monto_aplicado: "524.82", cuota_pagada: false }),
      fila(81129, 18, { monto_aplicado: "3272.61", mora: "32.57" }),
    ]);
    expect(r.representativo).toBe(81129);
    expect(r.pagoIds).toEqual([81129, 169567]);
    expect(r.cuotas).toEqual([18, 19]);
    expect(r.montoAplicado).toBeCloseTo(3797.43, 2);
    expect(r.mora).toBeCloseTo(32.57, 2);
    expect(r.estado).toBe("aplicado");
    expect(r.completa).toBe(true);
  });

  test("si una fila de la boleta sigue pendiente, la boleta no está completa", () => {
    const r = resumirBoleta([fila(1, 18), fila(2, 19, { validation_status: "pending" })]);
    expect(r.estado).toBe("en_validacion");
    expect(r.completa).toBe(false);
  });

  test("una boleta anulada sale anulada", () => {
    const r = resumirBoleta([fila(1, 18, { payment_false: true })]);
    expect(r.estado).toBe("anulado");
    expect(r.completa).toBe(false);
  });
});
