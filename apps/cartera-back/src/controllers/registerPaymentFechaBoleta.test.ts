import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { camposObligatoriosCondonacion } from "./registerPaymentPolicy";

describe("camposObligatoriosCondonacion", () => {
  test("completo → sin errores", () => {
    expect(camposObligatoriosCondonacion({ url_boletas: ["b.jpg"], numeroAutorizacion: "A-1", banco_id: 3 })).toEqual({});
  });
  test("falta cada uno → error por campo; espacios en blanco no cuentan", () => {
    expect(camposObligatoriosCondonacion({ url_boletas: [], numeroAutorizacion: "  ", banco_id: undefined })).toEqual({
      url_boletas: ["url_boletas es obligatorio para condonar por boleta tardía"],
      numeroAutorizacion: ["numeroAutorizacion es obligatorio para condonar por boleta tardía"],
      banco_id: ["banco_id es obligatorio para condonar por boleta tardía"],
    });
  });
  test("banco_id 0 (valor inicial del formulario) no cuenta", () => {
    expect(camposObligatoriosCondonacion({ url_boletas: ["b.jpg"], numeroAutorizacion: "A-1", banco_id: 0 })).toHaveProperty("banco_id");
  });
});

test("insertPayment valida fecha_boleta contra hoyGuatemala() y no la aplica a Nexa", () => {
  const src = readFileSync(new URL("./registerPayment.ts", import.meta.url), "utf8");
  const i = src.indexOf("if (nexaPaymentEventId === undefined) {\n      const errorFechaBoleta");
  expect(i).toBeGreaterThan(-1);
  const bloque = src.slice(i, i + 420);
  expect(bloque).toContain("validarFechaBoleta(fecha_boleta, ymdDeFechaCalendario(hoyGuatemala()))");
  expect(bloque).toContain("set.status = 400");
  expect(bloque).toContain("validationFailed({ fecha_boleta: [errorFechaBoleta] })");
  expect(i).toBeLessThan(src.indexOf("if (!holdsPaymentAdvisoryLock(paymentLock, credito_id)) {"));
});
