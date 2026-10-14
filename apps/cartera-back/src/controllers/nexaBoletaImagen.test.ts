import { describe, expect, mock, test } from "bun:test";
import type { DatosBoletaNexa } from "./nexaBoletaImagen";

mock.module("../database", () => ({ db: {}, client: {} }));

const {
  formatearFechaBoleta,
  formatearMontoQ,
  htmlBoletaNexa,
} = await import("./nexaBoletaImagen");

const datos = (pagoId: number, over: Partial<DatosBoletaNexa> = {}): DatosBoletaNexa => ({
  pagoId,
  numeroAutorizacion: "36418016",
  monto: "2500.5",
  fechaBoleta: "2026-10-01",
  numeroSifco: "01010203000123",
  cliente: "Cliente de Prueba",
  ...over,
});

describe("htmlBoletaNexa", () => {
  test("lleva el número de transferencia, el monto con miles y la fecha sin correr el día", () => {
    const html = htmlBoletaNexa(datos(1, { monto: "1234567.5", fechaBoleta: "2026-10-01" }));
    expect(html).toContain("36418016");
    expect(html).toContain("Q 1,234,567.50");
    expect(html).toContain("01/10/2026");
    expect(html).toContain("Comprobante de transferencia");
    expect(html).toContain("Transferencia ACH");
    expect(html).toContain("No es un documento emitido por el banco.");
  });

  test("escapa los valores", () => {
    const html = htmlBoletaNexa(datos(1, { cliente: "<script>alert(1)</script>", numeroAutorizacion: "a&b\"c" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a&amp;b&quot;c");
  });

  test("sin logo cae al texto y con logo lo embebe", () => {
    expect(htmlBoletaNexa(datos(1))).toContain('class="logo-texto"');
    expect(htmlBoletaNexa(datos(1), "data:image/png;base64,AAAA")).toContain('src="data:image/png;base64,AAAA"');
  });

  test("formatos", () => {
    expect(formatearMontoQ("0.5")).toBe("Q 0.50");
    expect(formatearMontoQ("100")).toBe("Q 100.00");
    expect(formatearMontoQ(null)).toBe("—");
    expect(formatearFechaBoleta("2026-01-31")).toBe("31/01/2026");
    expect(formatearFechaBoleta(null)).toBe("—");
  });
});
