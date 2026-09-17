import { describe, expect, it } from "bun:test";
import {
  RUTA_CAMBIO_DE_PASSWORD,
  usuarioQueCambioSuPassword,
} from "./cambioDePassword";

describe("usuarioQueCambioSuPassword", () => {
  const respuestaOk = { token: "tok", user: { id: "usr_1", email: "a@b.com" } };

  it("reconoce el cambio aplicado", () => {
    expect(
      usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, respuestaOk),
    ).toBe("usr_1");
  });

  it("ignora cualquier otro endpoint aunque devuelva un usuario", () => {
    // `/sign-in/email` y `/update-user` también responden con `user`: si el
    // hook no filtrara por ruta, entrar a la cuenta bastaría para dar por
    // cambiada la contraseña.
    expect(usuarioQueCambioSuPassword("/sign-in/email", respuestaOk)).toBeNull();
    expect(usuarioQueCambioSuPassword("/update-user", respuestaOk)).toBeNull();
    expect(usuarioQueCambioSuPassword(undefined, respuestaOk)).toBeNull();
  });

  it("no da por cambiada una contraseña cuando el intento falló", () => {
    // Un intento fallido llega como APIError, que no trae `user`.
    const error = Object.assign(new Error("INVALID_PASSWORD"), {
      status: "BAD_REQUEST",
      body: { message: "Invalid password" },
    });
    expect(usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, error)).toBeNull();
  });

  it("rechaza respuestas sin un id utilizable", () => {
    expect(usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, null)).toBeNull();
    expect(usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, {})).toBeNull();
    expect(
      usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, { user: null }),
    ).toBeNull();
    expect(
      usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, { user: { id: 42 } }),
    ).toBeNull();
    expect(
      usuarioQueCambioSuPassword(RUTA_CAMBIO_DE_PASSWORD, { user: { id: "  " } }),
    ).toBeNull();
  });
});
