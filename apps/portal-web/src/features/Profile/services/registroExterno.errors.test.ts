import { describe, expect, it } from "bun:test";

import {
  RegistroExternoError,
  conflictoDeRegistro,
  registroExternoErrorDesde,
} from "./registroExterno.errors";

describe("registroExternoErrorDesde", () => {
  it("conserva el status y el código del rechazo de auth-google", () => {
    const error = registroExternoErrorDesde({
      response: {
        status: 409,
        data: {
          message: "El DPI ya está registrado en otra cuenta",
          error: "dpi_ya_registrado",
        },
      },
    });

    expect(error.status).toBe(409);
    expect(error.codigo).toBe("dpi_ya_registrado");
    expect(error.message).toBe("El DPI ya está registrado en otra cuenta");
  });

  it("cae a un mensaje genérico cuando no hay respuesta", () => {
    const error = registroExternoErrorDesde(new Error("Network Error"));

    expect(error.status).toBeNull();
    expect(error.codigo).toBeNull();
    expect(error.message).toBe("Error al registrar usuario externo");
  });
});

describe("conflictoDeRegistro", () => {
  it("lleva el DPI duplicado al campo dpi del formulario", () => {
    const conflicto = conflictoDeRegistro(
      new RegistroExternoError(
        409,
        "dpi_ya_registrado",
        "El DPI ya está registrado en otra cuenta",
      ),
    );

    expect(conflicto).toEqual({
      campo: "dpi",
      mensaje: "El DPI ya está registrado en otra cuenta",
    });
  });

  it("no inventa un conflicto de campo para una caída del servidor", () => {
    expect(
      conflictoDeRegistro(new RegistroExternoError(500, null, "Boom")),
    ).toBeNull();
  });

  it("ignora errores que no vienen del registro externo", () => {
    expect(conflictoDeRegistro(new Error("cualquier cosa"))).toBeNull();
  });
});
