import { describe, expect, it } from "bun:test";
import { resolverFechaCompra } from "./addInvestorToCredit";

describe("resolverFechaCompra", () => {
  it("usa la fecha explícita al mediodía (evita corrimiento de TZ)", () => {
    const d = resolverFechaCompra("2026-06-10")!;
    expect(d.toISOString().slice(0, 10)).toBe("2026-06-10");
  });

  it("devuelve undefined cuando no viene fecha (deja el default now())", () => {
    expect(resolverFechaCompra(undefined)).toBeUndefined();
  });
});
