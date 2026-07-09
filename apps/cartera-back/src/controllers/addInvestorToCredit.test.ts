import { describe, expect, it } from "bun:test";
import { resolverFechaCompra, esFechaCalendarioValida } from "./addInvestorToCredit";

describe("resolverFechaCompra", () => {
  it("usa la fecha explícita al mediodía (evita corrimiento de TZ)", () => {
    const d = resolverFechaCompra("2026-06-10")!;
    expect(d.toISOString().slice(0, 10)).toBe("2026-06-10");
  });

  it("devuelve undefined cuando no viene fecha (deja el default now())", () => {
    expect(resolverFechaCompra(undefined)).toBeUndefined();
  });

  it("rechaza una fecha de calendario inválida (rollover silencioso)", () => {
    expect(() => resolverFechaCompra("2026-02-30")).toThrow("fecha_compra inválida: 2026-02-30");
  });
});

describe("esFechaCalendarioValida", () => {
  it("acepta una fecha real", () => {
    expect(esFechaCalendarioValida("2026-06-10")).toBe(true);
  });

  it("rechaza rollover silencioso (2026-02-30 → marzo)", () => {
    expect(esFechaCalendarioValida("2026-02-30")).toBe(false);
  });

  it("rechaza mes inválido (2026-13-01 → Invalid Date)", () => {
    expect(esFechaCalendarioValida("2026-13-01")).toBe(false);
  });
});
