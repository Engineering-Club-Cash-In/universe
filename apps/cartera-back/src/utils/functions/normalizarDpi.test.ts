import { describe, expect, it } from "bun:test";
import { normalizarDpiParaComparar } from "./normalizarDpi";

describe("normalizarDpiParaComparar", () => {
  it("quita ceros a la izquierda para poder comparar bigint contra varchar", () => {
    expect(normalizarDpiParaComparar("04036613")).toBe("4036613");
    expect(normalizarDpiParaComparar(4036613)).toBe("4036613");
  });

  it("descarta lo que no sea dígitos, en vez de convertir a número", () => {
    // dpi_rep_legal admite 20 dígitos y un bigint topa en 19: un BigInt()
    // podría desbordar con un valor mal capturado. Comparar texto no revienta.
    expect(normalizarDpiParaComparar("no-es-un-dpi")).toBeNull();
    expect(normalizarDpiParaComparar("")).toBeNull();
    expect(normalizarDpiParaComparar("   ")).toBeNull();
    expect(normalizarDpiParaComparar("0000")).toBeNull();
    expect(normalizarDpiParaComparar(null)).toBeNull();
    expect(normalizarDpiParaComparar(undefined)).toBeNull();
    expect(normalizarDpiParaComparar("12345678901234567890")).toBe("12345678901234567890");
  });

  it("recorta espacios: el DPI llega de columnas distintas y no siempre limpio", () => {
    expect(normalizarDpiParaComparar("  04036613 ")).toBe("4036613");
  });
});
