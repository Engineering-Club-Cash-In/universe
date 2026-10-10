import { expect, it } from "bun:test";
import { pagoEntroPorNexa, textoAdvertenciaEditarPagoNexa } from "./advertenciaEditarPagoNexa";

it("pago Nexa arma el texto con el monto", () => {
  expect(textoAdvertenciaEditarPagoNexa({ canal: "NEXA", monto_boleta: "1234.5" })).toBe(
    "Este pago entró por Nexa. Nexa ya aprobó esa transferencia por Q1,234.50 y no se puede cambiar allá. Si editás los montos, cartera y Nexa van a quedar distintos. ¿Guardar igual?",
  );
  expect(pagoEntroPorNexa({ entroPorNexa: true })).toBe(true);
});

it("pago manual no advierte", () => {
  expect(textoAdvertenciaEditarPagoNexa({ canal: "MANUAL", monto_boleta: "10" })).toBeNull();
  expect(textoAdvertenciaEditarPagoNexa(null)).toBeNull();
});
