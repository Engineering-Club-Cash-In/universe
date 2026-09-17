import { describe, expect, it } from "bun:test";
import { fmtQ } from "./moneda";

// Definición única del formato de quetzales. Vivía copiada en Latefee.tsx,
// ModalHistorialMora.tsx y MoraHistorial.tsx; este test fija el contrato para
// que las pantallas que la comparten no puedan divergir en decimales.
describe("fmtQ", () => {
  it("siempre lleva dos decimales", () => {
    expect(fmtQ(1234.5)).toBe("Q 1,234.50");
    expect(fmtQ(1000)).toBe("Q 1,000.00");
    expect(fmtQ(0.5)).toBe("Q 0.50");
  });

  it("redondea a dos decimales", () => {
    expect(fmtQ(1234.567)).toBe("Q 1,234.57");
  });

  it("acepta el string que manda la base (numeric de Postgres)", () => {
    expect(fmtQ("1234.56")).toBe("Q 1,234.56");
  });

  it("null, undefined y vacío son cero, no 'NaN'", () => {
    expect(fmtQ(null)).toBe("Q 0.00");
    expect(fmtQ(undefined)).toBe("Q 0.00");
  });

  it("negativos y cero", () => {
    expect(fmtQ(0)).toBe("Q 0.00");
    expect(fmtQ(-250.4)).toBe("Q -250.40");
  });
});
