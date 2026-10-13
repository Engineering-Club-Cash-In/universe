import { expect, it } from "bun:test";
import {
  MENSAJE_PAGO_NEXA_NO_ANULABLE,
  motivoNoAnularPago,
  puedeAnularPago,
} from "./puedeAnularPago";

it("un pago con canal NEXA no se puede anular", () => {
  expect(puedeAnularPago({ canal: "NEXA" })).toBe(false);
  expect(motivoNoAnularPago({ canal: "NEXA" })).toBe(
    "Este pago entró por Nexa y no se puede anular.",
  );
  expect(MENSAJE_PAGO_NEXA_NO_ANULABLE).toBe(motivoNoAnularPago({ canal: "NEXA" }));
});

it("entroPorNexa (listado con inversionistas) tampoco", () => {
  expect(puedeAnularPago({ entroPorNexa: true })).toBe(false);
});

it("un pago Nexa cuyo evento quedó failed (Nexa devolvió el dinero) sí se puede anular", () => {
  expect(puedeAnularPago({ canal: "NEXA", nexaEventoFallido: true })).toBe(true);
  expect(puedeAnularPago({ entroPorNexa: true, nexaEventoFallido: true })).toBe(true);
  expect(motivoNoAnularPago({ canal: "NEXA", nexaEventoFallido: true })).toBeUndefined();
  // Sin el dato, o en false, sigue bloqueado.
  expect(puedeAnularPago({ canal: "NEXA", nexaEventoFallido: false })).toBe(false);
  expect(puedeAnularPago({ entroPorNexa: true, nexaEventoFallido: null })).toBe(false);
});

it("manual o sin dato se puede anular", () => {
  expect(puedeAnularPago({ canal: "MANUAL" })).toBe(true);
  expect(puedeAnularPago({ entroPorNexa: false })).toBe(true);
  expect(puedeAnularPago({})).toBe(true);
  expect(puedeAnularPago(undefined)).toBe(true);
  expect(motivoNoAnularPago({ canal: "MANUAL" })).toBeUndefined();
});
