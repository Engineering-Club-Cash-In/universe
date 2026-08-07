import { describe, expect, it } from "bun:test";
import {
  debeProtegerCuota,
  excelSinPagoRegistrado,
  pagoTieneAplicacion,
  type FilaExcelMontos,
} from "./actualizarPagosExcelPolicy";

const filaVacia: FilaExcelMontos = {
  abono_capital: 0,
  abono_interes: 0,
  abono_iva_12: 0,
  abono_interes_ci: 0,
  abono_iva_ci: 0,
  abono_seguro: 0,
  abono_gps: 0,
  membresias_pago: 0,
  pago_del_mes: 0,
  mora: 0,
  otros: 0,
};

describe("excelSinPagoRegistrado", () => {
  it("detecta la fila que el Excel todavía no trae cobrada", () => {
    expect(excelSinPagoRegistrado(filaVacia)).toBe(true);
  });

  it("no marca vacía una fila con cualquier abono", () => {
    for (const campo of Object.keys(filaVacia) as Array<keyof FilaExcelMontos>) {
      expect(excelSinPagoRegistrado({ ...filaVacia, [campo]: 1.5 })).toBe(false);
    }
  });

  it("una cuota de solo mora cuenta como pago registrado", () => {
    expect(excelSinPagoRegistrado({ ...filaVacia, mora: 646.38 })).toBe(false);
  });
});

describe("pagoTieneAplicacion", () => {
  it("reconoce el pago aplicado aunque los numeric lleguen como string", () => {
    expect(
      pagoTieneAplicacion({
        monto_aplicado: "1341.97",
        abono_capital: "536.55",
        abono_interes: "300.58",
      }),
    ).toBe(true);
  });

  it("es false para el recibo sembrado que nadie pagó", () => {
    expect(
      pagoTieneAplicacion({
        monto_aplicado: "0.00",
        pago_del_mes: "0.00",
        abono_capital: "0.00",
        abono_interes: null,
        membresias_pago: undefined,
        otros: "0",
        pagoConvenio: "0.00",
      }),
    ).toBe(false);
  });

  it("cuenta mora, otros y convenio como plata aplicada", () => {
    expect(pagoTieneAplicacion({ mora: "450.00" })).toBe(true);
    expect(pagoTieneAplicacion({ otros: "150" })).toBe(true);
    expect(pagoTieneAplicacion({ pagoConvenio: "98.00" })).toBe(true);
  });

  it("ignora basura no numérica en el text de otros", () => {
    expect(pagoTieneAplicacion({ otros: "" })).toBe(false);
    expect(pagoTieneAplicacion({ otros: "n/a" })).toBe(false);
  });
});

describe("debeProtegerCuota", () => {
  it("protege la cuota ya aplicada cuando el Excel viene vacío (caso pago 53941)", () => {
    expect(
      debeProtegerCuota(filaVacia, [{ tiene_aplicacion: true }]),
    ).toBe(true);
  });

  it("no protege si el Excel sí trae el pago: el sync sigue mandando", () => {
    expect(
      debeProtegerCuota({ ...filaVacia, abono_capital: 536.55, pago_del_mes: 1341.97 }, [
        { tiene_aplicacion: true },
      ]),
    ).toBe(false);
  });

  it("no protege una cuota sin nada aplicado en la DB (escribir ceros es no-op)", () => {
    expect(debeProtegerCuota(filaVacia, [{ tiene_aplicacion: false }])).toBe(false);
  });

  it("en cuota parcial basta que UN pago tenga plata aplicada", () => {
    expect(
      debeProtegerCuota(filaVacia, [{ tiene_aplicacion: false }, { tiene_aplicacion: true }]),
    ).toBe(true);
  });

  it("no protege una cuota sin pagos", () => {
    expect(debeProtegerCuota(filaVacia, [])).toBe(false);
  });
});
