import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

import type { RegisterExternalUserPayload } from "../services/unified";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: {
  user: { id: string; name?: string; email?: string };
} | null = null;

// Payload con el que la ruta invocó al registro externo.
let payloadExterno: RegisterExternalUserPayload | null = null;
// DPI con el que la ruta escribió la identidad del portal.
let dpiAplicado: string | null = null;

mock.module("../config/env", () => ({
  env: { INTERNAL_API_SECRET: "secreto-de-servicio" },
}));

mock.module("../db/connection", () => ({
  db: {},
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

mock.module("../services/portalIdentity.service", () => ({
  applyRegistrationOutcome: (_userId: string, userType: string, dpi: string) => {
    dpiAplicado = dpi;
    return Promise.resolve({ dpi, role: userType });
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

describe("POST /register-external-auth", () => {
  beforeEach(() => {
    sessionActual = null;
    payloadExterno = null;
    dpiAplicado = null;
  });

  it("normaliza el DPI con separadores antes de tocar el sistema externo", async () => {
    sessionActual = {
      user: { id: "user-1", name: "Ana Pérez", email: "ana@example.com" },
    };

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234-56789-0123",
    });

    expect(res.status).toBe(200);
    // Cartera hace `parseInt` sobre este valor: con los separadores crudos
    // registraría el DPI 1234 mientras Better Auth guarda los 13 dígitos.
    expect(payloadExterno?.dpi).toBe("1234567890123");
    expect(dpiAplicado).toBe("1234567890123");
  });

  it("rechaza un DPI que no llega a 13 dígitos", async () => {
    sessionActual = {
      user: { id: "user-1", name: "Ana Pérez", email: "ana@example.com" },
    };

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234-567",
    });

    expect(res.status).toBe(400);
    expect(payloadExterno).toBeNull();
  });
});
