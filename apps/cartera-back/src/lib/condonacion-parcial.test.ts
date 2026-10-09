import { describe, expect, test } from "bun:test";
import { motivoRebajaParcialNoPermitida } from "./condonacion-parcial";

describe("motivoRebajaParcialNoPermitida", () => {
  test("estados con régimen propio no se rebajan", () => {
    for (const estado of ["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION", "CAIDO"]) {
      expect(motivoRebajaParcialNoPermitida(estado)).toContain(estado);
    }
  });

  test("ACTIVO, MOROSO, EN_RECUPERACION y EN_JURIDICO sí se pueden rebajar", () => {
    for (const estado of ["ACTIVO", "MOROSO", "EN_RECUPERACION", "EN_JURIDICO"]) {
      expect(motivoRebajaParcialNoPermitida(estado)).toBeNull();
    }
  });

  test("sin estado no bloquea (el crédito ya se valida por mora activa)", () => {
    expect(motivoRebajaParcialNoPermitida(null)).toBeNull();
    expect(motivoRebajaParcialNoPermitida(undefined)).toBeNull();
  });
});
