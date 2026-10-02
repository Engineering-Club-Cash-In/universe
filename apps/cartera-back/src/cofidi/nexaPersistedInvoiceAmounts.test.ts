import { expect, test } from "bun:test";
import Big from "big.js";
import {
  nexaPersistedInvoiceAmounts,
  oldestActivatedPendingPurchaseAtCutoff,
} from "./nexaPersistedInvoiceAmounts";
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
test("allows a reconciled distribution without CUBE", () => {
  expect([...nexaPersistedInvoiceAmounts([rows[0]!], {
    interest: "569.65",
    vat: "68.36",
    recipients: [recipients[0]!],
  }).keys()]).toEqual([1]);
});
test("recovers the exact persisted CUBE base and IVA residual after a full sale", () => {
  const result = nexaPersistedInvoiceAmounts([rows[0]!], {
    ...expected,
    recipients: [recipients[0]!],
    canonicalCube: recipients[1],
  });

  expect(result.get(86)).toEqual({
    precioUnitario: 235.05,
    precio: 235.05,
    montoGravable: 209.87,
    montoImpuesto: 25.18,
    total: 235.05,
  });
});
test("recovers an absent-CUBE residual without consulting the current credit roster", () => {
  expect(nexaPersistedInvoiceAmounts([rows[0]!], {
    ...expected,
    recipients: [recipients[0]!],
    canonicalCube: recipients[1],
  }).get(86)?.total).toBe(235.05);
});
test("rejects invalid absent-CUBE residuals", () => {
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], {
    ...expected,
    recipients: [recipients[0]!],
  })).toThrow("nexa_invoice_distribution_mismatch");
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], {
    interest: "500",
    vat: "60",
    recipients: [recipients[0]!],
    canonicalCube: recipients[1],
  })).toThrow("nexa_invoice_distribution_mismatch");
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], {
    interest: "779.521",
    vat: expected.vat,
    recipients: [recipients[0]!],
    canonicalCube: recipients[1],
  })).toThrow("nexa_invoice_distribution_mismatch");
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], {
    ...expected,
    recipients: [recipients[0]!],
    canonicalCube: { ...recipients[1]!, nombre: "OTRO INVERSOR" },
  })).toThrow("nexa_invoice_distribution_mismatch");
  expect(() => nexaPersistedInvoiceAmounts([rows[0]!], {
    ...expected,
    recipients: [recipients[0]!],
    canonicalCube: { ...recipients[1]!, inversionista_id: 87 },
  })).toThrow("nexa_invoice_distribution_mismatch");
});
test("requires canonical id 86 when CUBE is present", () => {
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
test("selects only the oldest activated purchase at payment application", () => {
  const pending = [
    {
      id: 20,
      fecha_completada: new Date("2026-09-01T12:00:00Z"),
      updated_at: new Date("2026-09-30T12:00:00Z"),
    },
    {
      id: 10,
      fecha_completada: new Date("2026-09-15T12:00:00Z"),
      updated_at: new Date("2026-09-30T10:30:00Z"),
    },
    {
      id: 5,
      fecha_completada: new Date("2026-09-20T12:00:00Z"),
      updated_at: new Date("2026-09-30T10:30:00Z"),
    },
    {
      id: 15,
      fecha_completada: new Date("2026-09-10T12:00:00Z"),
      updated_at: null,
    },
  ];
  const selected = oldestActivatedPendingPurchaseAtCutoff(
    pending,
    new Date("2026-09-30T11:00:00Z"),
  );

  expect(selected?.id).toBe(5);
  expect(pending.filter(operation => operation.id !== selected?.id).map(operation => operation.id)).toEqual([20, 10, 15]);
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
  expect(router).not.toContain("nexa_invoice_distribution_requires_reconciliation");
  expect(router).toContain("} else if (!nexaInvoiceAmounts && tieneOperacionesPendientesFacturar) {");
  expect(router).toContain(".from(inversionistas)");
  expect(router).toContain("new Set([...rowInvestorIds, 86])");
  expect(router).not.toContain("investorIds: [...inversionistasDelPago.map");
  expect(router).not.toContain("investorIds: inversionistasDelCredito.map");
  expect(router).toContain("const inversionistasMalConfigurados = nexaInvoiceAmounts ? [] : inversionistasDelCredito");
  expect(router).toContain("const persistedCubeId = nexaInvoiceAmounts ? 86 : cubeId");
  expect(router).toContain(".filter(id => id !== persistedCubeId)");
  expect(router).toContain("const idsInversionistas = nexaInvoiceRecipients");
  expect(router).toContain(": inversionistasDelPago.map(inv => inv.inversionista_id)");
  expect(router).toContain("const inv = nexaInvoiceRecipients?.get(invId)");
  expect(router).toContain("const persistedCube = nexaInvoiceAmounts?.get(86)");
  expect(router).toContain("canonicalCube: recipients.find(inv => inv.inversionista_id === 86)");
  expect(router).toContain("fecha_aplicado: pagos_credito.fecha_aplicado");
  expect(router).toContain("createdAt: pagos_credito.createdAt");
  expect(router).toContain("updated_at: compras_credito_inversionista.updated_at");
  expect(router).toMatch(/const redirigirACube =\s*!nexaInvoiceAmounts &&\s*pagoData\.bandera_reinversion === true/);
  expect(router).toContain("const cutoffNexa = pagoData.fecha_aplicado ?? pagoData.createdAt");
  expect(router).toContain("oldestActivatedPendingPurchaseAtCutoff(operacionesPendientesFacturar, cutoffNexa)");
  expect(router).toContain("${!nexaInvoiceAmounts && pagoData.bandera_reinversion === true}");
  expect(router).toMatch(/nexaInvoiceAmounts &&\s*hayInteresEnPago &&\s*interesFlujoOk/);
  expect(router).toContain("cuotaInfo?.pagado === true && !huboErroresInteresNexa");
  expect(router).toContain('process.env.SIMULAR_FACTURAS !== "true"');
  expect(router).toContain("const calc = persistedAmounts ?? calcularIvaExacto");
  expect(router).toContain("const calcCube = persistedCube ?? calcularIvaExacto");
  expect(router).toContain("const calc = persistedAmounts ?? calcularIvaExacto(parseFloat(totalInv.toFixed(2)))");
  expect(router).toContain("const calcCube = persistedCube ?? calcularIvaExacto(parseFloat(totalCubeRounded.toFixed(2)))");
  expect(router.match(/interesCubeIvaPersistido = persistedCube\?\.montoImpuesto;/g)).toHaveLength(2);
  expect(router).toMatch(/const totalCubeFinal = nexaInvoiceAmounts\s*\? new Big\(persistedCube\?\.total \?\? 0\)/);
  expect(router).toMatch(/const totalCube = nexaInvoiceAmounts\s*\? new Big\(persistedCube\?\.total \?\? 0\)/);
  expect(router).not.toContain("const totalCubeFinal = persistedCube");
  expect(router).not.toContain("const totalCube = persistedCube");
  expect(router).toContain('pushRubro("INTERES", interesCubeConIva, true, interesCubeIvaPersistido)');
});
