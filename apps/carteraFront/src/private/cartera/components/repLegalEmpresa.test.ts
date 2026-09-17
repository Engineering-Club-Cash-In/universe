import { describe, expect, it } from "bun:test";
import {
  REP_LEGAL_REQUERIDO,
  errorRepLegal,
  esEmpresaInicial,
  requiereConfirmacionBorrado,
  valorRepLegalAlGuardar,
} from "./repLegalEmpresa";

describe("interruptor ¿Es empresa?", () => {
  it("arranca marcado cuando la fila ya tiene representante", () => {
    expect(esEmpresaInicial("01234567", null)).toBe(true);
  });

  it("arranca sin marcar en modo crear y con el campo vacío o nulo", () => {
    expect(esEmpresaInicial(undefined, null)).toBe(false);
    expect(esEmpresaInicial(null, null)).toBe(false);
    expect(esEmpresaInicial("", null)).toBe(false);
    expect(esEmpresaInicial("   ", null)).toBe(false);
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
  const guardar = (over: Partial<Parameters<typeof valorRepLegalAlGuardar>[0]> = {}) =>
    valorRepLegalAlGuardar({
      esEmpresa: true,
      valor: "01234567",
      repLegalOriginal: null,
      dpiOriginal: null,
      dpiDelFormulario: null,
      ...over,
    });

  it("conserva los ceros a la izquierda tal cual", () => {
    expect(guardar()).toBe("01234567");
  });

  it("recorta espacios", () => {
    expect(guardar({ valor: " 123 " })).toBe("123");
  });

  it("manda null (borrar) al desmarcar a quien SÍ tenía representante", () => {
    expect(
      guardar({
        esEmpresa: false,
        valor: "123",
        repLegalOriginal: "999",
        dpiOriginal: "111",
        dpiDelFormulario: "111",
      }),
    ).toBeNull();
  });

  it("no manda nada de quien nunca tuvo representante", () => {
    expect(
      guardar({ esEmpresa: false, valor: "123", repLegalOriginal: "" }),
    ).toBeUndefined();
  });
});

// El inversionista 187: `dpi = 4036613`, `dpi_rep_legal = '04036613'`. Abre con
// el interruptor apagado porque se representa a sí mismo.
describe("el que es su propio representante", () => {
  const guardar = (dpiDelFormulario: string | number | null) =>
    valorRepLegalAlGuardar({
      esEmpresa: false,
      valor: "",
      repLegalOriginal: "04036613",
      dpiOriginal: 4036613,
      dpiDelFormulario,
    });

  it("no se le toca el campo si lo editado fue otra cosa", () => {
    expect(guardar(4036613)).toBeUndefined();
    // El mismo número con el cero delante sigue siendo el mismo número.
    expect(guardar("04036613")).toBeUndefined();
  });

  // Sin esto, `dpi_rep_legal` se quedaba con el DPI VIEJO y `dpi` con el nuevo:
  // dos números distintos, que es literalmente la definición de empresa que usa
  // el backend. La fila dejaba de recibir cuenta propia y pasaba a estar
  // representada por una identidad que ya no es la suya.
  it("le sigue el DPI cuando lo editado fue el DPI", () => {
    expect(guardar(5551234)).toBe("5551234");
  });

  it("se borra si el DPI se dejó vacío: conservar el viejo lo volvía empresa", () => {
    expect(guardar("")).toBeNull();
    expect(guardar(null)).toBeNull();
  });
});

describe("confirmación de borrado", () => {
  it("la pide al desmarcar un inversionista que ya tenía representante", () => {
    expect(requiereConfirmacionBorrado("123", false, null)).toBe(true);
  });

  it("no la pide si nunca tuvo representante", () => {
    expect(requiereConfirmacionBorrado("", false, null)).toBe(false);
    expect(requiereConfirmacionBorrado(undefined, false, null)).toBe(false);
  });

  it("no la pide si el interruptor sigue marcado", () => {
    expect(requiereConfirmacionBorrado("123", true, null)).toBe(false);
  });
});

/**
 * Representarse a sí mismo NO es ser una empresa.
 *
 * Caso real de producción: el inversionista 187 (Javier Kafie) tiene
 * `dpi = 4036613` y `dpi_rep_legal = '04036613'`. Es el MISMO número con un
 * cero delante, porque `dpi` es bigint y `dpi_rep_legal` varchar. El backend ya
 * los normaliza y lo trata como PERSONA (`esEmpresaRepresentada` en
 * `cartera-back/src/utils/functions/provisionamientoPortal.ts`).
 *
 * Mientras el front derive el interruptor de "el campo no está vacío", esa fila
 * se abre etiquetada como empresa y, al desmarcar, se le advierte al operador
 * que le va a quitar el acceso "a otra persona". No hay otra persona.
 */
describe("el que se representa a sí mismo es una persona", () => {
  it("no marca el interruptor cuando el representante es la propia fila", () => {
    expect(esEmpresaInicial("04036613", 4036613)).toBe(false);
  });

  it("sigue marcándolo cuando el representante es OTRO", () => {
    expect(esEmpresaInicial("1573661970101", 4036613)).toBe(true);
  });

  it("tampoco pide confirmación para quitarle un representante que es él mismo", () => {
    // La advertencia dice que se le borra el acceso a un tercero. No lo hay.
    expect(requiereConfirmacionBorrado("04036613", false, 4036613)).toBe(false);
  });

  it("sí la pide cuando el representante era otra persona", () => {
    expect(requiereConfirmacionBorrado("1573661970101", false, 4036613)).toBe(true);
  });
});
