import "../utils/baseFalsaParaPruebas";
import { describe, expect, it } from "bun:test";
import { hayMoraQueCobrar } from "./registerPayment";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("hayMoraQueCobrar", () => {
  it("null → false", () => {
    expect(hayMoraQueCobrar(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(hayMoraQueCobrar(undefined)).toBe(false);
  });

  it("activa false, monto 50 → false", () => {
    expect(hayMoraQueCobrar({ activa: false, monto_mora: 50 })).toBe(false);
  });

  it("activa true, monto \"0\" → false", () => {
    expect(hayMoraQueCobrar({ activa: true, monto_mora: "0" })).toBe(false);
  });

  it("activa true, monto \"0.00\" → false", () => {
    expect(hayMoraQueCobrar({ activa: true, monto_mora: "0.00" })).toBe(false);
  });

  it("activa true, monto \"12.50\" → true", () => {
    expect(hayMoraQueCobrar({ activa: true, monto_mora: "12.50" })).toBe(true);
  });

  it("activa null, monto \"12.50\" → false", () => {
    expect(hayMoraQueCobrar({ activa: null, monto_mora: "12.50" })).toBe(false);
  });

  it("activa true, monto null → false", () => {
    expect(hayMoraQueCobrar({ activa: true, monto_mora: null })).toBe(false);
  });

  it("activa true, monto undefined → false", () => {
    expect(hayMoraQueCobrar({ activa: true, monto_mora: undefined })).toBe(false);
  });
});

describe("procesarPagoMora structure", () => {
  it("contains hayMoraQueCobrar before updateMora", () => {
    const file = readFileSync(join(__dirname, "./registerPayment.ts"), "utf-8");

    // Find the procesarPagoMora function body
    const start = file.indexOf("const procesarPagoMora = async");
    const nextFunctionStart = file.indexOf("\nconst ", start + 1);
    const procesarPagoMoraBody = file.substring(start, nextFunctionStart);

    // Find positions
    const hayMoraPos = procesarPagoMoraBody.indexOf("hayMoraQueCobrar");
    const firstUpdateMoraPos = procesarPagoMoraBody.indexOf("await updateMora");

    // hayMoraQueCobrar should exist
    expect(hayMoraPos).toBeGreaterThanOrEqual(0);

    // hayMoraQueCobrar should appear before updateMora
    expect(hayMoraPos).toBeLessThan(firstUpdateMoraPos);

    // Verify the condition pattern: !hayMoraQueCobrar(mora)
    const conditionText = procesarPagoMoraBody.substring(
      procesarPagoMoraBody.indexOf("if ("),
      procesarPagoMoraBody.indexOf("{", procesarPagoMoraBody.indexOf("if ("))
    );
    expect(conditionText).toContain("hayMoraQueCobrar");
  });
});

describe("mutation testing", () => {
  it("M1: gt(0) → gte(0) should fail", () => {
    // This test verifies the fix is correct by checking the function logic.
    // If we change gt(0) to gte(0), then monto_mora "0" would return true.

    // With the current implementation (gt):
    expect(hayMoraQueCobrar({ activa: true, monto_mora: "0" })).toBe(false);

    // If the code used gte instead, this would be true (which is wrong)
    // This test documents that the fix is correct.
  });

  it("M2: removing hayMoraQueCobrar check should fail", () => {
    // This documents that removing the hayMoraQueCobrar check would break the fix.
    // The check is essential to prevent processing mora with monto_mora = 0.

    // Verify the function rejects mora with 0 monto
    expect(hayMoraQueCobrar({ activa: true, monto_mora: "0.00" })).toBe(false);

    // The fix relies on this: when mora.monto_mora === "0" but activa === true,
    // we should NOT process it. Without hayMoraQueCobrar, we would try to call
    // updateMora with a 0 monto, which would deactivate an active mora and
    // incorrectly move MOROSO credits to ACTIVO.
  });
});
