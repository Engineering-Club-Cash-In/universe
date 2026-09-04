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
// Escrituras que hizo la ruta sobre la tabla de usuarios.
let escrituras: Record<string, unknown>[] = [];
// Ids de usuario borrados (el rollback de la importación masiva).
let borrados: unknown[] = [];
// Simula el choque contra la restricción única de `users.dpi`.
let updateFalla = false;
// Altas que pidió la importación masiva a Better Auth.
let altas: { name: string; email: string }[] = [];

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
          if (updateFalla) {
            const fallo = Promise.reject(
              new Error(
                'duplicate key value violates unique constraint "users_dpi_unique"',
              ),
            );
            return Object.assign(fallo, { returning: () => fallo });
          }

          escrituras.push(valores);
          // El builder de Drizzle es "thenable" y encadenable a la vez: se
          // puede await directo o pedirle `.returning()`, que es lo que hace
          // el ascenso de rol para detectar que perdió la carrera.
          const resultado = Promise.resolve([{ id: "fila-actualizada" }]);
          return Object.assign(resultado, {
            returning: () => Promise.resolve([{ id: "fila-actualizada" }]),
          });
        },
      }),
    }),
    delete: () => ({
      where: (condicion: unknown) => {
        borrados.push(condicion);
        return Promise.resolve();
      },
    }),
  },
}));

mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(sessionActual),
      signUpEmail: ({ body }: { body: { name: string; email: string } }) => {
        altas.push({ name: body.name, email: body.email });
        return Promise.resolve({ user: { id: `nuevo-${body.email}` } });
      },
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

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`http://localhost/api/unified${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const sesionDeAna = {
  user: { id: "user-1", name: "Ana Pérez", email: "ana@example.com" },
};

/** La cuenta de la sesión, tal como la lee `applyRegistrationOutcome`. */
const cuentaDeAna = { id: "user-1", role: "CLIENT", dpi: null };

beforeEach(() => {
  sessionActual = null;
  payloadExterno = null;
  filasSelect = [];
  escrituras = [];
  borrados = [];
  altas = [];
  updateFalla = false;
});

describe("POST /register-external-auth", () => {
  it("normaliza el DPI con separadores antes de tocar el sistema externo", async () => {
    sessionActual = sesionDeAna;
    // 1) la cuenta de la sesión, 2) DPI libre (dentro de setUserDpi)
    filasSelect = [[cuentaDeAna], []];

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

// La ruta pública mandaba al CRM el secreto de servicio con datos que elegía
// quien llamaba, y `createPortalRegisterLead` devuelve el lead ENTERO cuando
// coincide el correo O el DPI. Cualquiera en internet podía sacar por ahí la
// ficha de un lead conocido —y, si ese lead tenía el correo vacío, hacer que el
// CRM le escribiera el suyo.
describe("POST /register-external (retirada)", () => {
  it("ya no existe: no hay forma de llegar al CRM sin sesión", async () => {
    const res = await postJson("/register-external", {
      userType: "CLIENT",
      fullName: "Ana Pérez",
      email: "victima@example.com",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(404);
    expect(payloadExterno).toBeNull();
  });
});

describe("POST /bulk-import-investors", () => {
  const conSecreto = { Authorization: "Bearer secreto-de-servicio" };

  const importar = (filas: unknown[]) =>
    postJson("/bulk-import-investors", filas, conSecreto);

  const unaFila = [
    { nombre: "Ana Pérez", dpi: "1234567890123", correo: "ana@example.com" },
  ];

  it("crea la cuenta y la deja como INVESTOR con su DPI", async () => {
    // Correo libre, DPI libre.
    filasSelect = [[], []];

    const res = await importar(unaFila);
    const cuerpo = (await res.json()) as { exitosos: number };

    expect(cuerpo.exitosos).toBe(1);
    expect(altas).toHaveLength(1);
    expect(escrituras).toContainEqual({
      role: "INVESTOR",
      dpi: "1234567890123",
    });
  });

  it("no crea la cuenta si el DPI ya pertenece a otro usuario", async () => {
    // Correo libre, pero el DPI ya está tomado por otra fila de `users`.
    filasSelect = [[], [{ id: "otro-usuario" }]];

    const res = await importar(unaFila);
    const cuerpo = (await res.json()) as {
      omitidos: number;
      omitidosDetalle: { motivo: string }[];
    };

    // El alta iba PRIMERO y el DPI se escribía después: la restricción única
    // reventaba el update y dejaba una cuenta huérfana como CLIENT, con una
    // contraseña aleatoria que nadie conoce y que el propio importador ya no
    // podía terminar (el chequeo de correo la marcaba "omitido" para siempre).
    expect(altas).toHaveLength(0);
    expect(cuerpo.omitidos).toBe(1);
    expect(cuerpo.omitidosDetalle[0].motivo).toContain("DPI");
  });

  it("borra la cuenta recién creada si la escritura del DPI falla", async () => {
    // Las dos comprobaciones pasan y aun así el update choca: es la carrera
    // entre dos filas del mismo lote con el mismo DPI.
    filasSelect = [[], []];
    updateFalla = true;

    const res = await importar(unaFila);
    const cuerpo = (await res.json()) as { fallidos: number };

    expect(cuerpo.fallidos).toBe(1);
    // Sin rollback, la cuenta a medias bloquea el reintento para siempre.
    expect(borrados).toHaveLength(1);
  });

  it("sigue omitiendo un correo que ya existe sin tocarlo", async () => {
    filasSelect = [[{ id: "ya-existe" }]];

    const res = await importar(unaFila);
    const cuerpo = (await res.json()) as { omitidos: number };

    expect(cuerpo.omitidos).toBe(1);
    expect(altas).toHaveLength(0);
    expect(borrados).toHaveLength(0);
  });

  it("rechaza sin el secreto de servicio", async () => {
    const res = await postJson("/bulk-import-investors", unaFila);

    expect(res.status).toBe(401);
    expect(altas).toHaveLength(0);
  });
});
