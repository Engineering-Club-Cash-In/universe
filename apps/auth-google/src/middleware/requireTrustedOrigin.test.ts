import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

const ORIGEN_PORTAL = "https://portal.clubcashin.com";
// Segundo dominio del portal: `CORS_ORIGIN` admite una lista separada por comas.
const ORIGEN_PORTAL_2 = "https://inversionistas.clubcashin.com";
const ORIGEN_AUTH = "https://auth-portal.clubcashin.com";
const ORIGEN_ATACANTE = "https://sitio-malicioso.example";
const COOKIE_SESION =
  "__Secure-better-auth.session_token=lo-que-el-navegador-adjunta";

// Escrituras que la ruta llegó a hacer sobre la tabla de usuarios. Si la
// defensa funciona, un intento cross-site las deja vacías.
let escrituras: Record<string, unknown>[] = [];

// `TRUSTED_ORIGINS` la interpreta `config/env.ts` a partir de estas variables
// (ver `lib/origins.test.ts`); aquí se inyecta ya resuelta.
mock.module("../config/env", () => ({
  env: {
    NODE_ENV: "production",
    CORS_ORIGIN: `${ORIGEN_PORTAL},${ORIGEN_PORTAL_2}`,
    FRONTEND_URL: ORIGEN_PORTAL,
    BETTER_AUTH_URL: ORIGEN_AUTH,
    TRUSTED_ORIGINS: [ORIGEN_PORTAL, ORIGEN_PORTAL_2, ORIGEN_AUTH],
  },
}));

mock.module("../db/connection", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: () => {
          escrituras.push(valores);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

// Sesión siempre válida: lo que se prueba no es la autenticación sino que una
// petición autenticada nacida en otro sitio no pueda mutar nada.
mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve({ user: { id: "victima" }, session: {} }),
    },
  },
}));

// Los módulos se cargan dentro de `beforeAll` para que los mocks de arriba ya
// estén en su sitio cuando el módulo real capture sus dependencias.
type Modulo = typeof import("./requireTrustedOrigin");

let COOKIE_AUTHENTICATED_PREFIXES: Modulo["COOKIE_AUTHENTICATED_PREFIXES"];
let evaluateOriginPolicy: Modulo["evaluateOriginPolicy"];
let normalizeOrigin: Modulo["normalizeOrigin"];
let requireTrustedOrigin: Modulo["requireTrustedOrigin"];
let resolveTrustedOrigins: Modulo["resolveTrustedOrigins"];
let profileRoutes: (typeof import("../routes/profile.routes"))["default"];

beforeAll(async () => {
  const modulo = await import("./requireTrustedOrigin");

  COOKIE_AUTHENTICATED_PREFIXES = modulo.COOKIE_AUTHENTICATED_PREFIXES;
  evaluateOriginPolicy = modulo.evaluateOriginPolicy;
  normalizeOrigin = modulo.normalizeOrigin;
  requireTrustedOrigin = modulo.requireTrustedOrigin;
  resolveTrustedOrigins = modulo.resolveTrustedOrigins;
  profileRoutes = (await import("../routes/profile.routes")).default;
});

const ORIGENES = [ORIGEN_PORTAL];

describe("evaluateOriginPolicy", () => {
  it("deja pasar los métodos que no mutan", () => {
    expect(
      evaluateOriginPolicy({
        method: "GET",
        origin: ORIGEN_ATACANTE,
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("allow");
  });

  // Servicio-a-servicio: sin cookie no hay credencial ambiental que abusar.
  it("deja pasar una petición sin cookie de sesión", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: undefined,
        cookieHeader: undefined,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("allow");
  });

  it("rechaza una escritura con cookie y sin cabecera Origin", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: undefined,
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("deny");
  });

  it("rechaza una escritura con cookie desde un origen ajeno", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: ORIGEN_ATACANTE,
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("deny");
  });

  // Un iframe en sandbox o un documento data: mandan literalmente "null".
  it("rechaza el origen opaco 'null'", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: "null",
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("deny");
  });

  it("rechaza un origen que solo comparte prefijo con el de confianza", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: "https://portal.clubcashin.com.evil.example",
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("deny");
  });

  it("acepta el origen del portal aunque venga con barra final", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: `${ORIGEN_PORTAL}/`,
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
      }),
    ).toBe("allow");
  });

  it("en desarrollo replica la política laxa del CORS local", () => {
    expect(
      evaluateOriginPolicy({
        method: "POST",
        origin: "http://localhost:5199",
        cookieHeader: COOKIE_SESION,
        trustedOrigins: ORIGENES,
        allowAnyOrigin: true,
      }),
    ).toBe("allow");
  });
});

describe("resolveTrustedOrigins", () => {
  // La lista viene de `env`, no se vuelve a interpretar aquí: es lo que impide
  // que esta defensa y el CORS global confíen en conjuntos distintos.
  it("usa la lista ya resuelta del entorno, con todos los dominios", () => {
    expect(resolveTrustedOrigins()).toEqual([
      ORIGEN_PORTAL,
      ORIGEN_PORTAL_2,
      ORIGEN_AUTH,
    ]);
  });
});

describe("normalizeOrigin", () => {
  it("descarta valores que no son un origen", () => {
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("   ")).toBeNull();
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("portal.clubcashin.com")).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });
});

describe("POST /api/profile/me/dpi detrás del middleware", () => {
  const construirApp = () => {
    const app = new Hono();
    // Se monta igual que en index.ts, iterando la misma constante.
    for (const ruta of COOKIE_AUTHENTICATED_PREFIXES) {
      app.use(ruta, requireTrustedOrigin);
    }
    app.route("/api/profile", profileRoutes);
    return app;
  };

  beforeEach(() => {
    escrituras = [];
  });

  // Este es el ataque real: POST "simple" (sin preflight) cuyo cuerpo es JSON.
  it("rechaza el POST text/plain lanzado desde un sitio ajeno", async () => {
    const res = await construirApp().request("/api/profile/me/dpi", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: ORIGEN_ATACANTE,
        Cookie: COOKIE_SESION,
      },
      body: JSON.stringify({ dpi: "1234567890123" }),
    });

    expect(res.status).toBe(403);
    expect(escrituras).toEqual([]);
  });

  // Un Blob con type vacío deja la petición sin Content-Type, así que la
  // heurística de "content-type de formulario" no basta como defensa.
  it("rechaza el POST sin Content-Type lanzado desde un sitio ajeno", async () => {
    const res = await construirApp().request("/api/profile/me/dpi", {
      method: "POST",
      headers: { Origin: ORIGEN_ATACANTE, Cookie: COOKIE_SESION },
      body: JSON.stringify({ dpi: "1234567890123" }),
    });

    expect(res.status).toBe(403);
    expect(escrituras).toEqual([]);
  });

  it("rechaza el POST que no manda Origin", async () => {
    const res = await construirApp().request("/api/profile/me/dpi", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE_SESION },
      body: JSON.stringify({ dpi: "1234567890123" }),
    });

    expect(res.status).toBe(403);
    expect(escrituras).toEqual([]);
  });

  // Antes, con dos dominios declarados, la cadena entera era el único "origen
  // de confianza" y ninguno de los dos casaba.
  it("deja pasar el POST del segundo dominio del portal", async () => {
    const res = await construirApp().request("/api/profile/me/dpi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGEN_PORTAL_2,
        Cookie: COOKIE_SESION,
      },
      body: JSON.stringify({ dpi: "1234567890123" }),
    });

    expect(res.status).toBe(200);
    expect(escrituras).toEqual([
      { dpi: "1234567890123", updatedAt: expect.any(Date) },
    ]);
  });

  it("deja pasar el POST del portal", async () => {
    const res = await construirApp().request("/api/profile/me/dpi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGEN_PORTAL,
        Cookie: COOKIE_SESION,
      },
      body: JSON.stringify({ dpi: "1234567890123" }),
    });

    expect(res.status).toBe(200);
    expect(escrituras).toEqual([
      { dpi: "1234567890123", updatedAt: expect.any(Date) },
    ]);
  });
});
