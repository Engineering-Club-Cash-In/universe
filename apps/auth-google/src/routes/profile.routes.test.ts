import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: { user: { id: string } } | null = null;
let dpiEscritoPara: string | null = null;

mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(sessionActual),
    },
  },
}));

// OJO: `mock.module` es global y sobrevive a este archivo. Este doble deja
// `setUserDpi` sustituido para toda la corrida, y por eso
// `portalIdentity.service.test.ts` ve una versión que nunca rechaza cuando la
// suite corre entera (está explicado allí).
mock.module("../services/portalIdentity.service", () => ({
  DpiFormatError: class DpiFormatError extends Error {},
  DpiAlreadyTakenError: class DpiAlreadyTakenError extends Error {},
  setUserDpi: (userId: string, dpi: string) => {
    dpiEscritoPara = userId;
    return Promise.resolve(dpi);
  },
}));

// El router se importa después de registrar los mocks, ya montado como en
// index.ts (`app.route("/api/profile", ...)`).
let app: Hono;

beforeAll(async () => {
  const { default: profileRoutes } = await import("./profile.routes");

  app = new Hono();
  app.route("/api/profile", profileRoutes);
});

const pedir = (path: string, init?: RequestInit) =>
  app.request(`http://localhost/api/profile${path}`, init);

const postJson = (path: string, body: unknown) =>
  pedir(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("rutas de perfil", () => {
  beforeEach(() => {
    sessionActual = null;
    dpiEscritoPara = null;
  });

  it("rechaza sin sesión la única ruta que queda", async () => {
    const res = await postJson("/me/dpi", { dpi: "1234567890101" });

    expect(res.status).toBe(401);
    expect(dpiEscritoPara).toBeNull();
  });

  it("escribe el DPI sobre el usuario de la sesión", async () => {
    sessionActual = { user: { id: "user-de-la-sesion" } };

    const res = await postJson("/me/dpi", { dpi: "1234567890101" });

    expect(res.status).toBe(200);
    expect(dpiEscritoPara).toBe("user-de-la-sesion");
  });

  it("ya no expone lectura ni escritura de perfil por :userId", async () => {
    sessionActual = { user: { id: "user-de-la-sesion" } };

    const rutasEliminadas = [
      pedir("/otro-usuario"),
      postJson("/otro-usuario/dpi", { dpi: "1234567890101" }),
      postJson("/otro-usuario/phone", { phone: "55555555" }),
      postJson("/otro-usuario/address", { address: "una dirección larga" }),
    ];

    for (const res of await Promise.all(rutasEliminadas)) {
      expect(res.status).toBe(404);
    }

    expect(dpiEscritoPara).toBeNull();
  });

  it("ya no expone el oráculo que confirma si un DPI está registrado", async () => {
    // Sin sesión ni siquiera se llega al router; con sesión, la ruta ya no
    // existe. En ninguno de los dos casos se contesta si el DPI está tomado.
    const sinSesion = await pedir("/check-dpi/1234567890101");
    expect(sinSesion.status).toBe(401);

    sessionActual = { user: { id: "user-de-la-sesion" } };
    const conSesion = await pedir("/check-dpi/1234567890101");
    expect(conSesion.status).toBe(404);
  });
});
