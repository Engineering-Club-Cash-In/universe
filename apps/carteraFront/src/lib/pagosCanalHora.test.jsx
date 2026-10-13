import { describe, expect, it } from "bun:test";
import { cierreCincoPm, etiquetaCanal, paramsRangoFechaPago } from "./pagosCanalHora";

describe("cierreCincoPm", () => {
  it("toma hoy y ayer en Guatemala, no en UTC", () => {
    // 7-oct 02:00 UTC = 6-oct 20:00 en Guatemala: hoy es el 6.
    expect(cierreCincoPm(new Date("2026-10-07T02:00:00Z"))).toEqual({
      fechaInicio: "2026-10-05", horaInicio: "17:00", fechaFin: "2026-10-06", horaFin: "17:00",
    });
  });
  it("cruza mes y año", () => {
    expect(cierreCincoPm(new Date("2026-01-01T15:00:00Z"))).toMatchObject({ fechaInicio: "2025-12-31", fechaFin: "2026-01-01" });
    expect(cierreCincoPm(new Date("2028-03-01T12:00:00Z"))).toMatchObject({ fechaInicio: "2028-02-29" });
  });
});

describe("paramsRangoFechaPago", () => {
  it("sin horas no manda horas (el backend filtra por día como siempre)", () => {
    expect(paramsRangoFechaPago({ fechaInicio: "2026-10-05", fechaFin: "2026-10-06", horaInicio: "", horaFin: "" }))
      .toEqual({ fechaInicio: "2026-10-05", fechaFin: "2026-10-06", horaInicio: undefined, horaFin: undefined });
  });
  it("manda solo la hora que se llenó", () => {
    expect(paramsRangoFechaPago({ fechaInicio: "2026-10-05", fechaFin: "", horaInicio: "17:00", horaFin: "" }))
      .toEqual({ fechaInicio: "2026-10-05", fechaFin: undefined, horaInicio: "17:00", horaFin: undefined });
  });
  it("no manda horaInicio si falta fechaInicio", () => {
    expect(paramsRangoFechaPago({ fechaInicio: "", fechaFin: "2026-10-06", horaInicio: "17:00", horaFin: "17:00" }))
      .toEqual({ fechaInicio: undefined, fechaFin: "2026-10-06", horaInicio: undefined, horaFin: "17:00" });
  });
  it("no manda horaFin si falta fechaFin", () => {
    expect(paramsRangoFechaPago({ fechaInicio: "2026-10-05", fechaFin: "", horaInicio: "17:00", horaFin: "17:00" }))
      .toEqual({ fechaInicio: "2026-10-05", fechaFin: undefined, horaInicio: "17:00", horaFin: undefined });
  });
});

describe("etiquetaCanal", () => {
  it("manual no lleva etiqueta", () => {
    expect(etiquetaCanal({ entroPorNexa: false })).toBeNull();
    expect(etiquetaCanal({})).toBeNull();
  });
  it("Nexa aplicado vs Nexa rechazado", () => {
    expect(etiquetaCanal({ entroPorNexa: true })?.label).toBe("Nexa");
    expect(etiquetaCanal({ entroPorNexa: true, nexaEventoFallido: true })?.label).toBe("Nexa · rechazado");
  });
});
