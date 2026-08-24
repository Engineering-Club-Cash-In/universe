import { describe, expect, it, beforeAll } from "bun:test";
import { z } from "zod";
import {
  ERROR_GENERAL,
  etiquetaCampo,
  formatFieldErrors,
  zodToFormikValidate,
} from "./formErrors";
import { zodErrorMapEspanol } from "./zodErrorMap";

beforeAll(() => {
  z.setErrorMap(zodErrorMapEspanol);
});

describe("etiquetaCampo", () => {
  it("usa el registro de etiquetas", () => {
    expect(etiquetaCampo("monto_boleta")).toBe("Monto Boleta");
    expect(etiquetaCampo("banco_id")).toBe("Banco");
    expect(etiquetaCampo("otros")).toBe("Otros");
  });

  it("humaniza un campo que no está en el registro", () => {
    expect(etiquetaCampo("campo_nuevo_raro")).toBe("Campo Nuevo Raro");
  });

  it("arma rutas anidadas legibles", () => {
    expect(etiquetaCampo("inversionistas.0.monto_aportado")).toBe(
      "Inversionistas #1 › Monto Aportado",
    );
    expect(etiquetaCampo("rubros.2.monto")).toBe("Rubros #3 › Monto");
  });
});

describe("formatFieldErrors", () => {
  it("arma el listado con encabezado", () => {
    const texto = formatFieldErrors({
      banco_id: "Debe seleccionar un banco",
      otros: "Debe ser un número válido",
    });
    expect(texto).toBe(
      "Campos con errores:\n• Banco: Debe seleccionar un banco\n• Otros: Debe ser un número válido",
    );
  });

  it("sin encabezado devuelve sólo las viñetas", () => {
    expect(formatFieldErrors({ otros: "Debe ser un número válido" }, "")).toBe(
      "• Otros: Debe ser un número válido",
    );
  });

  it("acepta el formato fieldErrors de zod (arrays)", () => {
    expect(formatFieldErrors({ otros: ["Debe ser un número válido"] }, "")).toBe(
      "• Otros: Debe ser un número válido",
    );
  });

  it("un error del formulario completo sale sin etiqueta de campo", () => {
    expect(formatFieldErrors({ [ERROR_GENERAL]: "El total no cuadra" }, "")).toBe(
      "• El total no cuadra",
    );
  });

  it("devuelve null si no hay nada que mostrar", () => {
    expect(formatFieldErrors({})).toBeNull();
    expect(formatFieldErrors({ otros: "   " })).toBeNull();
    expect(formatFieldErrors({ otros: [] })).toBeNull();
  });
});

describe("zodToFormikValidate", () => {
  const schema = z.object({
    monto_boleta: z.number().min(0.01),
    inversionistas: z
      .array(z.object({ monto_aportado: z.number().nonnegative() }))
      .optional(),
  });

  it("no reporta errores cuando los datos son válidos", () => {
    expect(zodToFormikValidate(schema)({ monto_boleta: 10 })).toEqual({});
  });

  it("usa la ruta completa para no aplastar los errores anidados", () => {
    const errores = zodToFormikValidate(schema)({
      monto_boleta: 10,
      inversionistas: [{ monto_aportado: 1 }, { monto_aportado: "x" }],
    });

    expect(errores).toEqual({
      "inversionistas.1.monto_aportado": "Debe ser un número válido",
    });
  });

  it("un refinement del objeto cae en ERROR_GENERAL, no en un campo inventado", () => {
    const conRefinement = z
      .object({ a: z.number(), b: z.number() })
      .refine((v) => v.a <= v.b, { message: "A no puede superar a B" });

    const errores = zodToFormikValidate(conRefinement)({ a: 5, b: 1 });

    expect(errores).toEqual({ [ERROR_GENERAL]: "A no puede superar a B" });
    expect(formatFieldErrors(errores)).toBe("Campos con errores:\n• A no puede superar a B");
  });

  it("el listado final del toast queda legible de punta a punta", () => {
    const errores = zodToFormikValidate(schema)({
      monto_boleta: "",
      inversionistas: [{ monto_aportado: "x" }],
    });

    expect(formatFieldErrors(errores)).toBe(
      "Campos con errores:\n" +
        "• Monto Boleta: Debe ser un número válido\n" +
        "• Inversionistas #1 › Monto Aportado: Debe ser un número válido",
    );
  });
});
