import { expect, test } from "bun:test";
import { bancoTexto, resumenRechazosNexa, tituloCuotaNexa, tonoCuotaNexa } from "./cuotasNexa";
import { estadoNexa, motivoRechazoNexa } from "./estadoNexa";

const cuota = (o) => ({ numero: 18, vencimiento: "2026-09-05", pagada: true, medio: "NEXA", banco: null, ...o });

test("color: morado Nexa, verde otro medio, gris no pagada aunque tenga abono", () => {
  expect(tonoCuotaNexa(cuota({}))).toBe("nexa");
  expect(tonoCuotaNexa(cuota({ medio: "MANUAL", banco: "Banrural" }))).toBe("otro");
  expect(tonoCuotaNexa(cuota({ pagada: false, medio: "NEXA" }))).toBe("pendiente");
  expect(tonoCuotaNexa(cuota({ pagada: false, medio: null }))).toBe("pendiente");
});

test("tooltip: número, vencimiento, si está pagada, medio y banco", () => {
  expect(tituloCuotaNexa(cuota({}))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · Nexa");
  expect(tituloCuotaNexa(cuota({ medio: "MANUAL", banco: "Banrural" }))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · Manual · Banrural");
  expect(tituloCuotaNexa(cuota({ medio: "MANUAL" }))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · Manual · Sin banco");
  expect(tituloCuotaNexa(cuota({ pagada: false, medio: null }))).toBe("Cuota 18 · vence 05/09/2026 · No pagada");
  expect(tituloCuotaNexa(cuota({ medio: null }))).toBe("Cuota 18 · vence 05/09/2026 · Pagada · sin detalle del medio");
  expect(tonoCuotaNexa(cuota({ medio: null }))).toBe("otro");
  expect(tituloCuotaNexa(cuota({ pagada: false, medio: "NEXA" }))).toBe("Cuota 18 · vence 05/09/2026 · No pagada · abono parcial Nexa");
});

test("banco: Nexa dice Nexa; manual sin banco dice Sin banco", () => {
  expect(bancoTexto("NEXA", "Banrural")).toBe("Nexa");
  expect(bancoTexto("MANUAL", "Banco Industrial")).toBe("Banco Industrial");
  expect(bancoTexto("MANUAL", null)).toBe("Sin banco");
});

test("motivos de rechazo en español, con genérico para los desconocidos", () => {
  expect(motivoRechazoNexa("token_mismatch")).toBe("El token es de otro crédito");
  expect(motivoRechazoNexa("binding_inactive")).toBe("Crédito cancelado");
  expect(motivoRechazoNexa("credit_cancelled")).toBe("Crédito cancelado");
  expect(motivoRechazoNexa("payment_not_applied")).toBe("Cartera no pudo aplicar el pago");
  expect(motivoRechazoNexa("credit_not_payable")).toBe("El crédito no admite pagos en su estado");
  expect(motivoRechazoNexa("amount_exceeds_binding")).toBe("El monto supera el tope permitido para Nexa");
  expect(motivoRechazoNexa("binding_expired")).toBe("La habilitación de Nexa del crédito venció");
  expect(motivoRechazoNexa("payment_outcome_uncertain:condonacion_anulada")).toBe("No se pudo confirmar si el pago quedó aplicado (condonacion_anulada)");
  expect(motivoRechazoNexa("codigo_nuevo")).toBe("Otro motivo (codigo_nuevo)");
  expect(motivoRechazoNexa(null)).toBe("Otro motivo (sin código)");
});

test("revisión manual se distingue de rechazado", () => {
  expect(estadoNexa("manual_review").etiqueta).toBe("En revisión manual");
  expect(estadoNexa("failed").etiqueta).toBe("Rechazado");
});

test("resumen de rechazos: separa rechazados de revisión manual y avisa si hay más", () => {
  const r = (estado) => ({ fecha: "2026-10-05T10:00:00", monto: "50.00", codigo: "token_mismatch", estado });
  expect(resumenRechazosNexa([r("failed")], 1)).toBe("1 rechazado");
  expect(resumenRechazosNexa([r("failed"), r("failed"), r("manual_review")], 3)).toBe("2 rechazados · 1 en revisión manual");
  expect(resumenRechazosNexa([r("manual_review")], 4)).toBe("1 en revisión manual · 3 más");
  expect(resumenRechazosNexa([], 0)).toBe("");
});
