import { expect, test } from "bun:test";
import { safeFailureReason } from "./repositories";

// toSafeReconciliationRow (admin, logs de conciliación) muestra los motivos
// internos conocidos tal cual y oculta cualquier texto libre.

test.each([
  "application_processing_failed",
  "payment_outcome_uncertain",
  "token_repair_failed:token_in_use",
  "token_repair_failed:credit_mismatch",
  "payment_outcome_uncertain:algun_detalle",
])("deja ver el motivo conocido %s", (reason) => {
  expect(safeFailureReason(reason)).toBe(reason);
});

test.each([
  "Cartera payment rejected: HTTP 409 Conflict (credit_not_payable)",
  "otro_prefijo:token_in_use",
  "payment_outcome_uncertain:Texto Libre",
  "payment_outcome_uncertain:a:b",
  "token_repair_failed:",
  `token_repair_failed:${"x".repeat(65)}`,
  "x".repeat(65),
  "DROP TABLE",
])("oculta el texto libre %j como processing_failed", (reason) => {
  expect(safeFailureReason(reason)).toBe("processing_failed");
});

test("sin motivo sigue siendo null", () => {
  expect(safeFailureReason(null)).toBeNull();
  expect(safeFailureReason("")).toBeNull();
});
