import { expect, test } from "bun:test";
import { estadoNexa } from "./estadoNexa";

const casos: [string | null, string, string][] = [
  ["applied", "Aplicado", "ok"],
  ["billed", "Aplicado y facturado", "ok"],
  ["billing_pending", "Aplicado · factura pendiente", "espera"],
  ["billing_failed", "Aplicado · factura fallida", "error"],
  ["failed", "Rechazado", "error"],
  ["manual_review", "En revisión manual", "espera"],
  ["estado_nuevo", "estado_nuevo", "neutro"],
  [null, "Sin estado", "neutro"],
];

for (const [estado, etiqueta, tono] of casos) {
  test(`${estado} → ${etiqueta} (${tono})`, () => {
    expect(estadoNexa(estado)).toEqual({ etiqueta, tono });
  });
}

