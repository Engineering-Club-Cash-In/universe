import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

import type { RegisterExternalUserPayload } from "../services/unified";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: {
  user: { id: string; name?: string; email?: string };
} | null = null;

// Payload con el que la ruta invocó al registro externo.
let payloadExterno: RegisterExternalUserPayload | null = null;

// Filas que devuelve el `select` de la BD de Better Auth, en orden de consulta.
let filasSelect: Record<string, unknown>[][] = [];
// Escrituras que hizo `applyRegistrationOutcome` sobre la cuenta.
let escrituras: Record<string, unknown>[] = [];

mock.module("../config/env", () => ({
  env: { INTERNAL_API_SECRET: "secreto-de-servicio" },
}));

// La BD se falsea a nivel de conexión, no de servicio: así el test ejercita el
// `portalIdentity.service` de verdad, que es donde vive la comprobación de DPI
// duplicado.
mock.module("../db/connection", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(filasSelect.shift() ?? []),
      }),
    }),
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

mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(sessionActual),
    },
  },
}));

mock.module("../services/unified", () => ({
  registerExternalUser: (payload: RegisterExternalUserPayload) => {
    payloadExterno = payload;
    return Promise.resolve({
      success: true,
      message: "ok",
      userType: payload.userType,
    });
  },
}));

let app: Hono;

beforeAll(async () => {
  const { default: unifiedRoutes } = await import("./unified.routes");

  app = new Hono();
  app.route("/api/unified", unifiedRoutes);
});

const postJson = (path: string, body: unknown) =>
  app.request(`http://localhost/api/unified${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const sesionDeAna = {
  user: { id: "user-1", name: "Ana Pérez", email: "ana@example.com" },
};

/** La cuenta de la sesión, tal como la lee `applyRegistrationOutcome`. */
const cuentaDeAna = { id: "user-1", role: "CLIENT", dpi: null };

describe("POST /register-external-auth", () => {
  beforeEach(() => {
    sessionActual = null;
    payloadExterno = null;
    filasSelect = [];
    escrituras = [];
  });

  it("normaliza el DPI con separadores antes de tocar el sistema externo", async () => {
    sessionActual = sesionDeAna;
    // 1) DPI libre, 2) la cuenta de la sesión, 3) DPI libre (dentro de setUserDpi)
    filasSelect = [[], [cuentaDeAna], []];

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234-56789-0123",
    });

    expect(res.status).toBe(200);
    // Cartera hace `parseInt` sobre este valor: con los separadores crudos
    // registraría el DPI 1234 mientras Better Auth guarda los 13 dígitos.
    expect(payloadExterno?.dpi).toBe("1234567890123");
    expect(escrituras).toContainEqual(
      expect.objectContaining({ dpi: "1234567890123" }),
    );
  });

  it("rechaza un DPI que no llega a 13 dígitos", async () => {
    sessionActual = sesionDeAna;

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234-567",
    });

    expect(res.status).toBe(400);
    expect(payloadExterno).toBeNull();
  });

  it("con el DPI tomado por otra cuenta responde 409 y no crea nada afuera", async () => {
    sessionActual = sesionDeAna;
    // El DPI ya pertenece a otra cuenta de Better Auth.
    filasSelect = [[{ id: "otro-usuario" }]];

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    // El conflicto tiene que salir ANTES del efecto externo: si cartera ya creó
    // al inversionista, el usuario se queda con el correo ocupado por una
    // cuenta sin identidad y una fila huérfana en cartera.
    expect(payloadExterno).toBeNull();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "dpi_ya_registrado",
    });
    expect(escrituras).toHaveLength(0);
  });

  it("rechaza sin sesión", async () => {
    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(401);
    expect(payloadExterno).toBeNull();
  });
});
