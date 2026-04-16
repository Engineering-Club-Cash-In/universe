import { describe, expect, it } from "bun:test";
import {
  boletaEstaEnPeriodo,
  requierePeriodoLiquidacion,
  resolveEstadoLiquidacionResumen,
} from "./investorLiquidationSummary";

describe("resolveEstadoLiquidacionResumen", () => {
  it("clasifica como pending cuando hay pagos no liquidados y no hay boleta pendiente", () => {
    expect(
      resolveEstadoLiquidacionResumen({
        requestedEstado: "pending",
        hasNoLiquidado: true,
        hasLiquidado: false,
        hasBoletaPendiente: false,
      })
    ).toBe("pending");
  });

  it("clasifica como uploaded cuando hay pagos no liquidados y boleta pendiente", () => {
    expect(
      resolveEstadoLiquidacionResumen({
        requestedEstado: "uploaded",
        hasNoLiquidado: true,
        hasLiquidado: false,
        hasBoletaPendiente: true,
      })
    ).toBe("uploaded");
  });

  it("clasifica como liquidated solo si no hay pagos no liquidados y si hay liquidados", () => {
    expect(
      resolveEstadoLiquidacionResumen({
        requestedEstado: "liquidated",
        hasNoLiquidado: false,
        hasLiquidado: true,
        hasBoletaPendiente: false,
      })
    ).toBe("liquidated");

    expect(
      resolveEstadoLiquidacionResumen({
        requestedEstado: "liquidated",
        hasNoLiquidado: true,
        hasLiquidado: true,
        hasBoletaPendiente: false,
      })
    ).toBeNull();
  });

  it("en all prioriza uploaded/pending sobre liquidated para reflejar estado actual", () => {
    expect(
      resolveEstadoLiquidacionResumen({
        requestedEstado: "all",
        hasNoLiquidado: true,
        hasLiquidado: true,
        hasBoletaPendiente: true,
      })
    ).toBe("uploaded");

    expect(
      resolveEstadoLiquidacionResumen({
        requestedEstado: "all",
        hasNoLiquidado: true,
        hasLiquidado: true,
        hasBoletaPendiente: false,
      })
    ).toBe("pending");
  });

  it("requiere periodo para liquidated y all", () => {
    expect(requierePeriodoLiquidacion("pending")).toBeFalse();
    expect(requierePeriodoLiquidacion("uploaded")).toBeFalse();
    expect(requierePeriodoLiquidacion("liquidated")).toBeTrue();
    expect(requierePeriodoLiquidacion("all")).toBeTrue();
  });

  it("valida si una boleta pertenece al periodo consultado", () => {
    const fecha = new Date("2026-03-15T18:00:00.000Z");

    expect(boletaEstaEnPeriodo(fecha, 3, 2026)).toBeTrue();
    expect(boletaEstaEnPeriodo(fecha, 2, 2026)).toBeFalse();
    expect(boletaEstaEnPeriodo(fecha, 3, 2025)).toBeFalse();
    expect(boletaEstaEnPeriodo(fecha)).toBeTrue();
  });
});
