import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const tabla = readFileSync(new URL("./paymentsTable.tsx", import.meta.url), "utf8");
const servicios = readFileSync(new URL("../services/services.ts", import.meta.url), "utf8");
const cuenta = (texto: string, re: RegExp) => (texto.match(re) ?? []).length;

test("el tipo del pago trae condonacionBoletaTardia", () => {
  expect(servicios).toContain("condonacionBoletaTardia?: { condonacionId: number; monto: string; asesor: string; anulada?: boolean } | null;");
});

test("la tabla pinta la etiqueta en los DOS detalles (junto a Fecha Boleta) y junto a AMBOS Ver Boletas", () => {
  expect(tabla).toContain('from "./condonacionBoletaTardiaEtiqueta"');
  expect(cuenta(tabla, /label: "Condonación por boleta tardía"/g)).toBe(2);
  expect(cuenta(tabla, /valorCondonacionBoletaTardia\(pago\.condonacionBoletaTardia\)/g)).toBeGreaterThanOrEqual(2);
  expect(cuenta(tabla, /\{\/\* Ver Boletas \*\/\}/g)).toBe(2);
  let desde = 0;
  for (let n = 0; n < 2; n++) {
    const i = tabla.indexOf("{/* Ver Boletas */}", desde);
    expect(tabla.slice(i - 700, i)).toContain("etiquetaCondonacionBoletaTardia(pago.condonacionBoletaTardia)");
    expect(tabla.slice(i - 700, i)).toContain("claseInsigniaCondonacionBoletaTardia(pago.condonacionBoletaTardia)");
    desde = i + 1;
  }
});
