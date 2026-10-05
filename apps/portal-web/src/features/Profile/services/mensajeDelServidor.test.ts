import { describe, expect, it } from "bun:test";

import { mensajeDelServidor } from "./mensajeDelServidor";

const RESPALDO = "Error al actualizar el DPI";

describe("mensajeDelServidor", () => {
  // Es la forma que tiene TODA respuesta de error de auth-google: el manejador
  // global (`middleware/error.ts`) serializa cada `HTTPException` como
  // `{ success: false, error: { message } }`. Leer `data.error` como si fuera
  // texto dejaba al usuario con "[object Object]" en vez del motivo.
  it("saca el motivo del error anidado de auth-google", () => {
    const mensaje = mensajeDelServidor(
      {
        response: {
          data: {
            success: false,
            error: { message: "El DPI ya está registrado en otra cuenta" },
          },
        },
      },
      RESPALDO,
    );

    expect(mensaje).toBe("El DPI ya está registrado en otra cuenta");
  });

  // Las rutas que contestan con `c.json` en vez de lanzar la excepción mandan
  // el mensaje plano; siguen funcionando.
  it("acepta también el mensaje plano", () => {
    expect(
      mensajeDelServidor(
        { response: { data: { message: "El campo dpi es requerido" } } },
        RESPALDO,
      ),
    ).toBe("El campo dpi es requerido");
  });

  it("acepta un error que es texto", () => {
    expect(
      mensajeDelServidor(
        { response: { data: { error: "Origen no permitido" } } },
        RESPALDO,
      ),
    ).toBe("Origen no permitido");
  });

  it("cae al respaldo cuando no hay respuesta que leer", () => {
    expect(mensajeDelServidor(new Error("Network Error"), RESPALDO)).toBe(
      RESPALDO,
    );
    expect(
      mensajeDelServidor({ response: { data: { error: {} } } }, RESPALDO),
    ).toBe(RESPALDO);
  });
});
