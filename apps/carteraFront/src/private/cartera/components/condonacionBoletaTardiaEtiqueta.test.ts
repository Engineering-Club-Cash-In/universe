import { describe, expect, test } from "bun:test";
import { claseInsigniaCondonacionBoletaTardia, etiquetaCondonacionBoletaTardia, valorCondonacionBoletaTardia } from "./condonacionBoletaTardiaEtiqueta";

describe("etiqueta de la condonación por boleta tardía para contabilidad", () => {
  test("valor y etiqueta completos, con monto string o number", () => {
    const c = { condonacionId: 9, monto: "11.20", asesor: "asesor@clubcashin.com" };
    expect(valorCondonacionBoletaTardia(c)).toBe("Q11.20 (asesor@clubcashin.com) (por toda la boleta)");
    expect(etiquetaCondonacionBoletaTardia(c)).toBe("Condonación por boleta tardía (por toda la boleta): Q11.20 (asesor@clubcashin.com)");
    expect(etiquetaCondonacionBoletaTardia({ ...c, monto: 7.4 })).toBe("Condonación por boleta tardía (por toda la boleta): Q7.40 (asesor@clubcashin.com)");
  });
  test("si la condonación está anulada, lo dice", () => {
    const c = { condonacionId: 9, monto: "11.20", asesor: "a@x.com", anulada: true };
    expect(valorCondonacionBoletaTardia(c)).toBe("Q11.20 (a@x.com) (por toda la boleta) — ANULADA");
    expect(etiquetaCondonacionBoletaTardia(c)).toBe("Condonación por boleta tardía ANULADA (por toda la boleta): Q11.20 (a@x.com)");
  });
  test("la clase de color distingue viva de anulada", () => {
    const c = { condonacionId: 9, monto: "1.00", asesor: "a@x.com" };
    expect(claseInsigniaCondonacionBoletaTardia(c)).toContain("amber");
    expect(claseInsigniaCondonacionBoletaTardia({ ...c, anulada: true })).toContain("line-through");
  });
  test("sin condonación, sin asesor o con monto inválido → null (no se pinta nada)", () => {
    expect(etiquetaCondonacionBoletaTardia(null)).toBeNull();
    expect(etiquetaCondonacionBoletaTardia(undefined)).toBeNull();
    expect(etiquetaCondonacionBoletaTardia({ condonacionId: 1, monto: "x", asesor: "a@x.com" })).toBeNull();
    expect(etiquetaCondonacionBoletaTardia({ condonacionId: 1, monto: "5.00", asesor: "" })).toBeNull();
    expect(valorCondonacionBoletaTardia(null)).toBeNull();
  });
});
