import { expect, test } from "bun:test";
import { estadoNexa, motivoRechazoNexa } from "./estadoNexa";

const casos: [string | null, string, string][] = [
  ["applied", "Aplicado", "ok"],
  ["billed", "Aplicado y facturado", "ok"],
  ["billing_pending", "Aplicado · factura pendiente", "espera"],
  ["billing_failed", "Aplicado · factura fallida", "error"],
  ["failed", "Rechazado", "error"],
  ["manual_review", "En revisión", "espera"],
  ["estado_nuevo", "estado_nuevo", "neutro"],
  [null, "Sin estado", "neutro"],
];

for (const [estado, etiqueta, tono] of casos) {
  test(`${estado} → ${etiqueta} (${tono})`, () => {
    expect(estadoNexa(estado)).toEqual({ etiqueta, tono });
  });
}

test("traduce los motivos de rechazo y deja ver los desconocidos", () => {
  expect(motivoRechazoNexa("token_mismatch")).toBe("El token del pago no coincide con el del crédito");
  expect(motivoRechazoNexa("binding_token_missing")).toBe("El crédito no tiene token registrado en cartera");
  expect(motivoRechazoNexa("codigo_nuevo")).toBe("Motivo técnico: codigo_nuevo");
  expect(motivoRechazoNexa(null)).toBe("Sin motivo registrado");
});
