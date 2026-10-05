import { describe, expect, it } from "bun:test";
import { normalizarEntrada } from "./numberField";

describe("normalizarEntrada", () => {
  it("nunca devuelve un string ni NaN como valor", () => {
    // Es la causa del bug original: formik guardaba "" y zod lo rechazaba.
    expect(normalizarEntrada("")).toEqual({ texto: "", valor: 0 });
    expect(normalizarEntrada(".")).toEqual({ texto: ".", valor: 0 });
    expect(normalizarEntrada("-")).toEqual({ texto: "-", valor: 0 });
  });

  it("acepta lo que se escribe normalmente", () => {
    expect(normalizarEntrada("5")).toEqual({ texto: "5", valor: 5 });
    expect(normalizarEntrada("1234.56")).toEqual({ texto: "1234.56", valor: 1234.56 });
    expect(normalizarEntrada("0.5")).toEqual({ texto: "0.5", valor: 0.5 });
  });

  it("quita el cero de la izquierda pero respeta el decimal", () => {
    expect(normalizarEntrada("05")).toEqual({ texto: "5", valor: 5 });
    expect(normalizarEntrada("007")).toEqual({ texto: "7", valor: 7 });
    expect(normalizarEntrada("0.75")).toEqual({ texto: "0.75", valor: 0.75 });
    expect(normalizarEntrada("0")).toEqual({ texto: "0", valor: 0 });
  });

  it("descarta la tecla cuando la entrada no es numérica", () => {
    expect(normalizarEntrada("abc")).toBeNull();
    expect(normalizarEntrada("1.2.3")).toBeNull();
    expect(normalizarEntrada("1e5")).toBeNull();
    expect(normalizarEntrada("1,000")).toBeNull();
  });

  describe("montos (permiteNegativos = false)", () => {
    it("no deja escribir el signo negativo", () => {
      expect(normalizarEntrada("-", false)).toBeNull();
      expect(normalizarEntrada("-55", false)).toBeNull();
      expect(normalizarEntrada("-0.5", false)).toBeNull();
    });

    it("sigue aceptando los positivos y el vacío", () => {
      expect(normalizarEntrada("555", false)).toEqual({ texto: "555", valor: 555 });
      expect(normalizarEntrada("", false)).toEqual({ texto: "", valor: 0 });
      expect(normalizarEntrada("0.5", false)).toEqual({ texto: "0.5", valor: 0.5 });
    });
  });

  it("por defecto permite negativos (para campos que sí los admitan)", () => {
    expect(normalizarEntrada("-55")).toEqual({ texto: "-55", valor: -55 });
  });
});
