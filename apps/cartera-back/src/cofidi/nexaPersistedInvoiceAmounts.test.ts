import { expect, test } from "bun:test";
import Big from "big.js";
import { nexaPersistedInvoiceAmounts } from "./nexaPersistedInvoiceAmounts";
const rows = [
  { inversionista_id: 1, abono_interes: "569.65", abono_iva_12: "68.36" },
  { inversionista_id: 86, abono_interes: "209.87", abono_iva_12: "25.18" },
];
const recipients = [
  { inversionista_id: 1, nombre: "INVERSOR UNO", emite_factura: false },
  { inversionista_id: 86, nombre: "CUBE INVESTMENTS", emite_factura: false },
];
const expected = { interest: "779.52", vat: "93.54", recipients };
test("preserves the actual ledger cents instead of re-splitting gross", () => {
  const result = nexaPersistedInvoiceAmounts(rows, expected);
  expect(result.get(1)).toEqual({ precioUnitario: 638.01, precio: 638.01, montoGravable: 569.65, montoImpuesto: 68.36, total: 638.01 });
  expect(result.get(86)).toEqual({ precioUnitario: 235.05, precio: 235.05, montoGravable: 209.87, montoImpuesto: 25.18, total: 235.05 });
  expect(new Big(result.get(1)!.total).plus(result.get(86)!.total).toFixed(2)).toBe("873.06");
  expect(new Big("797.50").times("0.80").toFixed(2)).toBe("638.00"); // legacy double-rounding reproduction
});
test("uses the persisted rows as the complete investor roster", () => {
  expect([...nexaPersistedInvoiceAmounts(rows, expected).keys()]).toEqual([1, 86]);
});
test("rejects incomplete, duplicate and mismatched distributions", () => {
  expect(() => nexaPersistedInvoiceAmounts([], expected)).toThrow();
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], expected)).toThrow();
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!, rows[0]!], expected)).toThrow();
  expect(() => nexaPersistedInvoiceAmounts(rows, { ...expected, vat: "93.55" })).toThrow();
});
test("requires exactly one canonical CUBE row", () => {
  expect(() => nexaPersistedInvoiceAmounts([
    rows[0]!,
    { ...rows[1]!, inversionista_id: 87 },
  ], expected)).toThrow("nexa_invoice_distribution_invalid");
  expect(() => nexaPersistedInvoiceAmounts([...rows, rows[1]!], {
    interest: "989.39",
    vat: "118.72",
    recipients,
  })).toThrow("nexa_invoice_distribution_invalid");
});
test("rejects missing or conflicting persisted recipient metadata", () => {
  expect(() => nexaPersistedInvoiceAmounts(rows, {
    ...expected,
    recipients: [recipients[1]!],
  })).toThrow("nexa_invoice_recipient_metadata_missing");
  expect(() => nexaPersistedInvoiceAmounts(rows, {
    ...expected,
    recipients: [
      { ...recipients[0]!, nombre: "CUBE INVESTMENTS DOS" },
      recipients[1]!,
    ],
  })).toThrow("nexa_invoice_distribution_invalid");
  expect(() => nexaPersistedInvoiceAmounts(rows, {
    ...expected,
    recipients: [
      recipients[0]!,
      { ...recipients[1]!, nombre: "OTRO INVERSOR" },
    ],
  })).toThrow("nexa_invoice_distribution_invalid");
});
test("rejects negatives and fractions of a cent", () => {
  for (const value of ["-0.01", "0.001", "NaN"]) {
    expect(() => nexaPersistedInvoiceAmounts([{ ...rows[0]!, abono_interes: value }, rows[1]!], expected)).toThrow();
  }
});
test("handles zero components without rederiving VAT", () => {
  expect(nexaPersistedInvoiceAmounts([{ inversionista_id: 86, abono_interes: "0", abono_iva_12: "0" }], {
    interest: "0",
    vat: "0",
    recipients: [recipients[1]!],
  }).get(86)?.total).toBe(0);
});
test("runtime-only opt-in and persisted amounts reach both fiscal item builders", async () => {
  const router = await Bun.file(new URL("../routers/cofidi.ts", import.meta.url)).text();
  const runtime = await Bun.file(new URL("../controllers/nexaPaymentRuntime.ts", import.meta.url)).text();
  expect(runtime).toContain("useNexaPersistedDistribution: true");
  expect(router).toContain("useNexaPersistedDistribution = false");
  expect(router).toContain("({ body, set }) => facturarPagoCompleto({ body, set })");
  expect(router.indexOf("nexaPersistedInvoiceAmounts(rows.map")).toBeLessThan(router.indexOf("// 3️⃣ CONSTRUIR RECEPTOR"));
  expect(router).toContain("rows.length === 0 && pagoData.cuota_id !== null");
  expect(router).toContain("cuotaInfo?.pagado !== false");
  expect(router.indexOf("cuotaInfo?.pagado !== false")).toBeLessThan(router.indexOf("pagoData.bandera_reinversion"));
  expect(router).toContain(".from(inversionistas)");
  expect(router).toContain("inArray(inversionistas.inversionista_id, rows.map(row => row.inversionista_id))");
  expect(router).not.toContain("investorIds: [...inversionistasDelPago.map");
  expect(router).toContain("const inversionistasMalConfigurados = nexaInvoiceAmounts ? [] : inversionistasDelCredito");
  expect(router).toContain("const persistedCubeId = nexaInvoiceAmounts ? 86 : cubeId");
  expect(router).toContain(".filter(id => id !== persistedCubeId)");
  expect(router).toContain("const idsInversionistas = nexaInvoiceRecipients");
  expect(router).toContain(": inversionistasDelPago.map(inv => inv.inversionista_id)");
  expect(router).toContain("const inv = nexaInvoiceRecipients?.get(invId)");
  expect(router).toContain("const persistedCube = nexaInvoiceAmounts?.get(86)");
  expect(router).toContain("const calc = persistedAmounts ?? calcularIvaExacto");
  expect(router).toContain("const calcCube = persistedCube ?? calcularIvaExacto");
  expect(router).toContain("const calc = persistedAmounts ?? calcularIvaExacto(parseFloat(totalInv.toFixed(2)))");
  expect(router).toContain("const calcCube = persistedCube ?? calcularIvaExacto(parseFloat(totalCubeRounded.toFixed(2)))");
  expect(router.match(/interesCubeIvaPersistido = persistedCube\?\.montoImpuesto;/g)).toHaveLength(2);
  expect(router).toContain('pushRubro("INTERES", interesCubeConIva, true, interesCubeIvaPersistido)');
});
