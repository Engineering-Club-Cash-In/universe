import { expect, test } from "bun:test";
import Big from "big.js";
import { nexaPersistedInvoiceAmounts } from "./nexaPersistedInvoiceAmounts";
const rows = [
  { inversionista_id: 1, abono_interes: "569.65", abono_iva_12: "68.36" },
  { inversionista_id: 2, abono_interes: "209.87", abono_iva_12: "25.18" },
];
const expected = { interest: "779.52", vat: "93.54", investorIds: [1, 2] };
test("preserves the actual ledger cents instead of re-splitting gross", () => {
  const result = nexaPersistedInvoiceAmounts(rows, expected);
  expect(result.get(1)).toEqual({ precioUnitario: 638.01, precio: 638.01, montoGravable: 569.65, montoImpuesto: 68.36, total: 638.01 });
  expect(result.get(2)).toEqual({ precioUnitario: 235.05, precio: 235.05, montoGravable: 209.87, montoImpuesto: 25.18, total: 235.05 });
  expect(new Big(result.get(1)!.total).plus(result.get(2)!.total).toFixed(2)).toBe("873.06");
  expect(new Big("797.50").times("0.80").toFixed(2)).toBe("638.00"); // legacy double-rounding reproduction
});
test("rejects incomplete, duplicate, foreign and mismatched distributions", () => {
  expect(() => nexaPersistedInvoiceAmounts([], expected)).toThrow();
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], expected)).toThrow();
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!, rows[0]!], expected)).toThrow();
  expect(() => nexaPersistedInvoiceAmounts(rows, { ...expected, investorIds: [1, 3] })).toThrow();
  expect(() => nexaPersistedInvoiceAmounts(rows, { ...expected, vat: "93.55" })).toThrow();
});
test("rejects negatives and fractions of a cent", () => {
  for (const value of ["-0.01", "0.001", "NaN"]) {
    expect(() => nexaPersistedInvoiceAmounts([{ ...rows[0]!, abono_interes: value }, rows[1]!], expected)).toThrow();
  }
});
test("handles zero components without rederiving VAT", () => {
  expect(nexaPersistedInvoiceAmounts([{ inversionista_id: 1, abono_interes: "0", abono_iva_12: "0" }], { interest: "0", vat: "0", investorIds: [1] }).get(1)?.total).toBe(0);
});
test("runtime-only opt-in and persisted amounts reach both fiscal item builders", async () => {
  const router = await Bun.file(new URL("../routers/cofidi.ts", import.meta.url)).text();
  const runtime = await Bun.file(new URL("../controllers/nexaPaymentRuntime.ts", import.meta.url)).text();
  expect(runtime).toContain("useNexaPersistedDistribution: true");
  expect(router).toContain("useNexaPersistedDistribution = false");
  expect(router).toContain("({ body, set }) => facturarPagoCompleto({ body, set })");
  expect(router.indexOf("nexaPersistedInvoiceAmounts(rows.map")).toBeLessThan(router.indexOf("// 3️⃣ CONSTRUIR RECEPTOR"));
  expect(router).toContain("const calc = persistedAmounts ?? calcularIvaExacto");
  expect(router).toContain("const calcCube = persistedCube ?? calcularIvaExacto");
});
