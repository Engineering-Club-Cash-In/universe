import { describe, expect, it } from "bun:test";

import { altaYaHecha, mensajeDeAltaFallida } from "./registroPendiente";

describe("altaYaHecha", () => {
  it("reconoce el alta hecha en este mismo ciclo del formulario", () => {
    expect(
      altaYaHecha({
        creadaEnEsteCiclo: true,
        correoDeLaSesion: null,
        correoDelFormulario: "ana@example.com",
      }),
    ).toBeTrue();
  });

  // El caso que el ref en memoria no cubría: tras recargar, `creadaEnEsteCiclo`
  // vuelve a false, pero la sesión que dejó `signUp.email` sigue viva y prueba
  // del lado del servidor que la cuenta ya existe.
  it("reconoce el alta de un intento anterior por la sesión abierta", () => {
    expect(
      altaYaHecha({
        creadaEnEsteCiclo: false,
        correoDeLaSesion: "ana@example.com",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBeTrue();
  });

  it("compara los correos sin distinguir mayúsculas ni espacios", () => {
    expect(
      altaYaHecha({
        creadaEnEsteCiclo: false,
        correoDeLaSesion: "  Ana@Example.com ",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBeTrue();
  });

  // Si la sesión es de OTRA cuenta, saltarse el alta ataría el registro a esa
  // cuenta ajena: el rol y el DPI del formulario terminarían escritos sobre
  // ella. Hay que crear la cuenta del correo que se pidió.
  it("no da por hecha el alta si la sesión es de otro correo", () => {
    expect(
      altaYaHecha({
        creadaEnEsteCiclo: false,
        correoDeLaSesion: "otro@example.com",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBeFalse();
  });

  it("no da por hecha el alta sin sesión", () => {
    expect(
      altaYaHecha({
        creadaEnEsteCiclo: false,
        correoDeLaSesion: null,
        correoDelFormulario: "ana@example.com",
      }),
    ).toBeFalse();

    expect(
      altaYaHecha({
        creadaEnEsteCiclo: false,
        correoDeLaSesion: "   ",
        correoDelFormulario: "ana@example.com",
      }),
    ).toBeFalse();
  });
});

describe("mensajeDeAltaFallida", () => {
  // El correo ya ocupado es el desenlace de un registro anterior a medias. La
  // recuperación vive tras iniciar sesión (el formulario de completar perfil),
  // así que hay que decirlo: antes esto devolvía sin mensaje y dejaba el
  // formulario mudo.
  it("manda a iniciar sesión cuando el correo ya está ocupado", () => {
    for (const resultado of [
      { error: { status: 422, code: "USER_ALREADY_EXISTS", message: "" } },
      { error: { status: 400, code: "USER_ALREADY_EXISTS", message: "" } },
      { error: { status: 422, code: null, message: "User already exists" } },
    ]) {
      expect(mensajeDeAltaFallida(resultado)).toContain("Inicia sesión");
    }
  });

  it("conserva el motivo cuando el servidor manda uno útil", () => {
    expect(
      mensajeDeAltaFallida({
        error: { status: 400, code: "PASSWORD_TOO_SHORT", message: "Contraseña muy corta" },
      }),
    ).toBe("Contraseña muy corta");
  });

  it("cae a un mensaje genérico cuando no hay nada aprovechable", () => {
    expect(mensajeDeAltaFallida({ error: {} })).toBeTruthy();
    expect(mensajeDeAltaFallida(undefined)).toBeTruthy();
    expect(mensajeDeAltaFallida(null)).toBeTruthy();
  });
});
