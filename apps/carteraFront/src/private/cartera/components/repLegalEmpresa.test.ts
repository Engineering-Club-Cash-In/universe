import { describe, expect, it } from "bun:test";
import {
  REP_LEGAL_REQUERIDO,
  errorRepLegal,
  esEmpresaInicial,
  requiereConfirmacionBorrado,
  valorRepLegalAEnviar,
} from "./repLegalEmpresa";

describe("interruptor ¿Es empresa?", () => {
  it("arranca marcado cuando la fila ya tiene representante", () => {
    expect(esEmpresaInicial("01234567")).toBe(true);
  });

  it("arranca sin marcar en modo crear y con el campo vacío o nulo", () => {
    expect(esEmpresaInicial(undefined)).toBe(false);
    expect(esEmpresaInicial(null)).toBe(false);
    expect(esEmpresaInicial("")).toBe(false);
    expect(esEmpresaInicial("   ")).toBe(false);
  });
});

describe("validación del DPI del representante", () => {
  it("lo exige cuando el interruptor está marcado", () => {
    expect(errorRepLegal(true, "")).toBe(REP_LEGAL_REQUERIDO);
    expect(errorRepLegal(true, "   ")).toBe(REP_LEGAL_REQUERIDO);
    expect(errorRepLegal(true, undefined)).toBe(REP_LEGAL_REQUERIDO);
  });

  it("no lo exige cuando el interruptor está sin marcar", () => {
    expect(errorRepLegal(false, "")).toBeUndefined();
  });

  it("acepta el DPI con ceros a la izquierda", () => {
    expect(errorRepLegal(true, "01234567")).toBeUndefined();
  });
});

describe("valor a enviar", () => {
  it("conserva los ceros a la izquierda tal cual", () => {
    expect(valorRepLegalAEnviar(true, "01234567")).toBe("01234567");
  });

  it("recorta espacios", () => {
    expect(valorRepLegalAEnviar(true, " 123 ")).toBe("123");
  });

  it("manda null (borrar) cuando el interruptor está sin marcar, aunque quede texto tecleado", () => {
    expect(valorRepLegalAEnviar(false, "123")).toBeNull();
  });
});

describe("confirmación de borrado", () => {
  it("la pide al desmarcar un inversionista que ya tenía representante", () => {
    expect(requiereConfirmacionBorrado("123", false)).toBe(true);
  });

  it("no la pide si nunca tuvo representante", () => {
    expect(requiereConfirmacionBorrado("", false)).toBe(false);
    expect(requiereConfirmacionBorrado(undefined, false)).toBe(false);
  });

  it("no la pide si el interruptor sigue marcado", () => {
    expect(requiereConfirmacionBorrado("123", true)).toBe(false);
  });
});
