import { describe, expect, test } from "bun:test";
import { validateCui } from "./cui";

describe("validateCui", () => {
  test.each([
    ["1234567890101", "verificador 9, depto 01 muni 01"],
    ["2000000120101", "verificador 2"],
    ["2000000122217", "último departamento con su máximo de municipios"],
    ["2000000121805", "depto 18 con su máximo (5)"],
    ["2000000121217", "depto 12 muni 17"],
  ])("válido %s (%s)", (cui) => {
    expect(validateCui(cui)).toEqual({ valid: true });
  });

  test("verificador incorrecto", () => {
    expect(validateCui("1234567800101")).toEqual({ valid: false, reason: "dígito verificador incorrecto" });
    expect(validateCui("2000000130101")).toMatchObject({ valid: false });
  });

  test("verificador 10 nunca es válido", () => {
    expect(validateCui("5000000000101")).toMatchObject({ valid: false, reason: "dígito verificador incorrecto" });
  });

  test("departamento fuera de 01-22", () => {
    expect(validateCui("1234567890001")).toEqual({ valid: false, reason: "departamento fuera de 01-22" });
    expect(validateCui("1234567892301")).toEqual({ valid: false, reason: "departamento fuera de 01-22" });
  });

  test("municipio 00 o sobre el máximo del departamento", () => {
    expect(validateCui("1234567890100")).toMatchObject({ valid: false });
    expect(validateCui("1234567890118")).toMatchObject({ valid: false }); // depto 1 máx 17
    expect(validateCui("2000000121806")).toMatchObject({ valid: false }); // depto 18 máx 5
    expect(validateCui("2000000120209")).toMatchObject({ valid: false }); // depto 2 máx 8
  });

  test("largo, caracteres y tipo", () => {
    expect(validateCui("123456789010")).toMatchObject({ valid: false });
    expect(validateCui("12345678901011")).toMatchObject({ valid: false });
    expect(validateCui("1234 56789 0101")).toMatchObject({ valid: false });
    expect(validateCui("123456789010a")).toMatchObject({ valid: false });
    expect(validateCui(1234567890101)).toMatchObject({ valid: false });
    expect(validateCui(undefined)).toMatchObject({ valid: false });
  });

  test("el motivo nunca incluye el CUI", () => {
    const cui = "1234567800101";
    const check = validateCui(cui);
    expect(JSON.stringify(check)).not.toContain(cui);
  });
});
