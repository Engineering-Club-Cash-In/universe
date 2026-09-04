import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

import type { RegisterExternalUserPayload } from "../services/unified";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: {
  user: { id: string; name?: string; email?: string };
} | null = null;

// Payload con el que la ruta invocó al registro externo, y cuántas veces.
let payloadExterno: RegisterExternalUserPayload | null = null;
let llamadasExternas = 0;
// Si se pone, `registerExternalUser` falla con este error.
let fallaRegistroExterno: Error | null = null;

// La fila de `users` de la cuenta que se está registrando. El `select` la
// devuelve cuando la proyección pide algo más que el id, y las escrituras la
// mutan, igual que haría la BD.
let filaUsuario: Record<string, unknown>[] = [];
// Cola de respuestas para los `select({ id })`: los que buscan por correo o
// por DPI en la importación masiva.
let filasSelect: Record<string, unknown>[][] = [];

// Modelo del índice único de `users.dpi`. Es lo que hace atómica la reserva.
let dpisReservados = new Set<string>();
// Escrituras aceptadas sobre la tabla de usuarios.
let escrituras: Record<string, unknown>[] = [];
// Ids de usuario borrados (el rollback de la importación masiva).
let borrados: unknown[] = [];
// Fuerza el fallo del update aunque el DPI esté libre.
let updateFalla = false;
// Altas que pidió la importación masiva a Better Auth.
let altas: { name: string; email: string }[] = [];

// Filas que devuelve el `returning` del UPDATE. Vacío = el predicado no casó
// con ninguna fila, que es como el ascenso de rol detecta que perdió la carrera
// contra un cambio de rol hecho por un administrador.
let filasActualizadas: Record<string, unknown>[] = [{ id: "fila-actualizada" }];

/**
 * El builder de Drizzle es "thenable" y encadenable a la vez: el llamador puede
 * await-earlo directo o pedirle `.returning()`.
 */
const builder = (resultado: Promise<unknown>) =>
  Object.assign(resultado, { returning: () => resultado });

/** El error que devuelve Postgres al chocar contra un índice único. */
const errorDeUnicidad = () =>
  Object.assign(
    new Error(
      'duplicate key value violates unique constraint "users_dpi_unique"',
    ),
    { code: "23505", constraint: "users_dpi_unique" },
  );

mock.module("../config/env", () => ({
  env: { INTERNAL_API_SECRET: "secreto-de-servicio" },
}));

// La BD se falsea a nivel de conexión, no de servicio: así el test ejercita de
// verdad el `portalIdentity.service`, que es donde vive la reserva del DPI.
mock.module("../db/connection", () => ({
  db: {
    select: (proyeccion: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          // Una proyección que pide más que el id es la lectura de la cuenta
          // propia; la de solo id son las búsquedas por correo/DPI.
          const pideLaCuenta =
            proyeccion && Object.keys(proyeccion).some((k) => k !== "id");

          // Copias, como devuelve drizzle: el llamador no puede quedarse con
          // una referencia viva a la fila y ver los cambios que él mismo hace.
          return Promise.resolve(
            (pideLaCuenta ? filaUsuario : (filasSelect.shift() ?? [])).map(
              (fila) => ({ ...fila }),
            ),
          );
        },
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: () => {
          if (updateFalla) {
            return builder(Promise.reject(errorDeUnicidad()));
          }

          const dpi = valores.dpi;

          if (typeof dpi === "string") {
            if (dpisReservados.has(dpi)) {
              return builder(Promise.reject(errorDeUnicidad()));
            }

            dpisReservados.add(dpi);
          }

          // La liberación devuelve el DPI al pozo.
          if (dpi === null && typeof filaUsuario[0]?.dpi === "string") {
            dpisReservados.delete(filaUsuario[0].dpi as string);
          }

          escrituras.push(valores);

          if (filaUsuario[0] && "dpi" in valores) {
            filaUsuario[0].dpi = dpi;
          }
          if (filaUsuario[0] && "role" in valores) {
            filaUsuario[0].role = valores.role;
          }

          return builder(Promise.resolve(filasActualizadas));
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
      // Permite que dos peticiones en paralelo lleven sesiones distintas.
      getSession: ({ headers }: { headers: Headers }) => {
        const id = headers?.get?.("x-test-user");

        if (id) {
          return Promise.resolve({
            user: { id, name: "Ana Pérez", email: `${id}@example.com` },
          });
        }

        return Promise.resolve(sessionActual);
      },
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
    llamadasExternas += 1;

    if (fallaRegistroExterno) {
      return Promise.reject(fallaRegistroExterno);
    }

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

const postJson = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(`http://localhost/api/unified${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const sesionDeAna = {
  user: { id: "user-1", name: "Ana Pérez", email: "ana@example.com" },
};

/** La cuenta de la sesión, tal como la leen la reserva y el alta de identidad. */
const cuentaDeAna = () => [{ id: "user-1", role: "CLIENT", dpi: null }];

beforeEach(() => {
  sessionActual = null;
  payloadExterno = null;
  llamadasExternas = 0;
  fallaRegistroExterno = null;
  filaUsuario = [];
  filasSelect = [];
  dpisReservados = new Set();
  escrituras = [];
  borrados = [];
  altas = [];
  updateFalla = false;
});

describe("POST /register-external-auth", () => {
  it("normaliza el DPI con separadores antes de tocar el sistema externo", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234-56789-0123",
    });

    expect(res.status).toBe(200);
    // Cartera hace `parseInt` sobre este valor: con los separadores crudos
    // registraría el DPI 1234 mientras Better Auth guarda los 13 dígitos.
    expect(payloadExterno?.dpi).toBe("1234567890123");
    expect(filaUsuario[0].dpi).toBe("1234567890123");
  });

  it("rechaza un DPI que no llega a 13 dígitos", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234-567",
    });

    expect(res.status).toBe(400);
    expect(llamadasExternas).toBe(0);
  });

  it("con el DPI tomado por otra cuenta responde 409 y no crea nada afuera", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    // El DPI ya pertenece a otra cuenta de Better Auth.
    dpisReservados.add("1234567890123");

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    // El conflicto tiene que salir ANTES del efecto externo: si cartera ya creó
    // al inversionista, el usuario se queda con el correo ocupado por una
    // cuenta sin identidad y una fila huérfana en cartera.
    expect(llamadasExternas).toBe(0);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "dpi_ya_registrado" });
  });

  it("reserva el DPI ANTES de llamar al servicio externo", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    // Si el registro externo se ejecuta, para entonces el DPI ya tiene que
    // estar escrito: es lo único que hace atómica la reserva.
    fallaRegistroExterno = Object.assign(new Error("cartera caída"), {});

    await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(llamadasExternas).toBe(1);
    expect(escrituras[0]).toMatchObject({ dpi: "1234567890123" });
  });

  it("libera la reserva si el registro externo falla, para poder reintentar", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    fallaRegistroExterno = new Error("cartera caída");

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(500);
    // Una reserva que no se libera deja el DPI bloqueado por un registro que
    // nunca se completó.
    expect(dpisReservados.has("1234567890123")).toBeFalse();
    expect(filaUsuario[0].dpi).toBeNull();
  });

  // Invariante del que depende la barrera de POST /api/cartera/investor: una
  // cuenta cuyo registro externo NO salió bien se queda en CLIENT. Es lo que
  // impide que quien crea una cuenta con el correo de un inversionista ajeno
  // llegue a INVESTOR (su alta choca en modo estricto con la fila que ya tiene
  // ese correo, y la reconciliación no la reconoce porque no lleva su sello).
  it("no asciende el rol si el registro externo falló", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    fallaRegistroExterno = new Error("ya existe un inversionista con ese email");

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(500);
    expect(filaUsuario[0].role).toBe("CLIENT");
    expect(escrituras.some((e) => e.role === "INVESTOR")).toBeFalse();
  });

  it("dos cuentas con el mismo DPI a la vez: una gana y la otra recibe 409", async () => {
    // Las dos leen la misma cuenta con el DPI libre, así que las dos pasan
    // cualquier comprobación que sea solo un SELECT.
    filaUsuario = [{ id: "user-a", role: "CLIENT", dpi: null }];

    const cuerpo = {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    };

    const [unaRes, otraRes] = await Promise.all([
      postJson("/register-external-auth", cuerpo, { "x-test-user": "user-a" }),
      postJson("/register-external-auth", cuerpo, { "x-test-user": "user-b" }),
    ]);

    const estados = [unaRes.status, otraRes.status].sort();

    // Sin reserva atómica las dos autorizan el registro externo y la perdedora
    // revienta después contra la restricción única con un 500 genérico.
    expect(estados).toEqual([200, 409]);
    expect(llamadasExternas).toBe(1);
  });

  it("un reintento del mismo usuario no choca contra su propia reserva", async () => {
    sessionActual = sesionDeAna;
    // El intento anterior ya dejó el DPI reservado en esta misma cuenta.
    filaUsuario = [{ id: "user-1", role: "CLIENT", dpi: "1234567890123" }];
    dpisReservados.add("1234567890123");

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(200);
    expect(llamadasExternas).toBe(1);
  });

  it("rechaza sin sesión", async () => {
    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(401);
    expect(llamadasExternas).toBe(0);
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
