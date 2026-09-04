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

// Modelo del índice único de `users.dpi`. Es la exclusión REAL: la
// comprobación previa es solo un SELECT y no excluye nada.
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
// La clase real, para que el `instanceof` de la ruta sea el de verdad.
let CrmLeadError: typeof import("../services/crm/profile.service").CrmLeadError;

beforeAll(async () => {
  CrmLeadError = (await import("../services/crm/profile.service")).CrmLeadError;

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
    // La comprobación previa encuentra el DPI en otra fila de `users`.
    filasSelect = [[{ id: "otra-cuenta" }]];

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

  // Antes, un fallo del registro externo obligaba a soltar una reserva escrita
  // del DPI. Ya no hay reserva que soltar: la ruta no escribe NADA hasta que el
  // alta externa sale bien, y el reintento repite la misma llamada y obtiene la
  // misma fila porque el alta en cartera es idempotente.
  it("no escribe identidad si el registro externo falla", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    fallaRegistroExterno = new Error("cartera caída");

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(500);
    expect(llamadasExternas).toBe(1);
    expect(escrituras).toEqual([]);
    expect(filaUsuario[0].dpi).toBeNull();
    // Y el DPI queda libre para el reintento, sin necesitar limpieza.
    expect(dpisReservados.has("1234567890123")).toBeFalse();
  });

  // Una cuenta cuyo registro externo NO salió bien se queda en CLIENT. El rol
  // es lo que decide privilegios, así que no puede subir por un alta que nunca
  // llegó a existir en CRM/cartera.
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

  // Dos cuentas distintas mandan el mismo DPI libre a la vez. La comprobación
  // previa es un SELECT y las dos la pasan: no es ella quien excluye.
  //
  // El reparto de responsabilidades es el que cambió. Que no se creen DOS
  // inversionistas lo garantiza el índice único de `cartera.inversionistas.dpi`,
  // que es de quien depende ahora (aquí el registro externo está falseado, así
  // que ese caso vive en la suite de cartera). Lo que esta ruta tiene que
  // garantizar es lo otro: que la perdedora de la carrera por `users.dpi`
  // reciba un 409 que puede corregir, y no el 500 genérico que daba antes.
  it("dos cuentas con el mismo DPI a la vez: una gana y la otra recibe 409", async () => {
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

    expect(estados).toEqual([200, 409]);
    expect(await (estados[0] === 409 ? unaRes : otraRes).json()).toMatchObject({
      error: "dpi_ya_registrado",
    });
  });

  it("un reintento del mismo usuario no choca contra su propio DPI", async () => {
    sessionActual = sesionDeAna;
    // El intento anterior ya dejó el DPI escrito en esta misma cuenta.
    filaUsuario = [{ id: "user-1", role: "CLIENT", dpi: "1234567890123" }];
    dpisReservados.add("1234567890123");
    // La comprobación previa se excluye a sí misma, así que no encuentra nada.
    filasSelect = [[]];

    const res = await postJson("/register-external-auth", {
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(200);
    expect(llamadasExternas).toBe(1);
  });

  // El camino de CLIENT: el CRM contesta 409 cuando el correo de la sesión ya
  // tiene un lead con OTRO DPI. Ese 409 salía de aquí como 500, el formulario
  // no lo reconocía como conflicto corregible y dejaba a la persona en el paso
  // 2 —sin el campo del DPI, que vive en el paso 1— leyendo "corrige tu DPI".
  it("propaga como 409 el rechazo del CRM por otro DPI", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    fallaRegistroExterno = new CrmLeadError(
      409,
      "Ya existe un registro con este correo y otro DPI.",
    );

    const res = await postJson("/register-external-auth", {
      userType: "CLIENT",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "dpi_no_coincide",
      message: "Ya existe un registro con este correo y otro DPI.",
    });
    // Y la identidad no se escribe: el alta externa no llegó a existir.
    expect(escrituras).toEqual([]);
  });

  // Un rechazo del CRM que la persona NO puede corregir en el formulario sigue
  // siendo un 500: solo el conflicto de identidad se promueve.
  it("no convierte en conflicto cualquier otro rechazo del CRM", async () => {
    sessionActual = sesionDeAna;
    filaUsuario = cuentaDeAna();
    fallaRegistroExterno = new CrmLeadError(500, "CRM caído");

    const res = await postJson("/register-external-auth", {
      userType: "CLIENT",
      fullName: "Ana Pérez",
      dpi: "1234567890123",
    });

    expect(res.status).toBe(500);
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

  // Un DPI vacío o mal escrito creaba igual la cuenta como INVESTOR, con ese
  // valor inservible en `users.dpi`. La corrección después no servía de nada:
  // el chequeo de correo marcaba la fila "omitido" para siempre y el importador
  // ya no podía terminar a ese inversionista.
  it("no crea la cuenta si el DPI no es válido", async () => {
    for (const dpi of ["", "   ", "1234", "12345678901234", "abcdefghijklm"]) {
      filasSelect = [[], []];
      altas = [];

      const res = await importar([
        { nombre: "Ana Pérez", dpi, correo: "ana@example.com" },
      ]);
      const cuerpo = (await res.json()) as {
        omitidos: number;
        omitidosDetalle: { motivo: string }[];
      };

      expect(altas).toHaveLength(0);
      expect(cuerpo.omitidos).toBe(1);
      expect(cuerpo.omitidosDetalle[0].motivo).toContain("DPI");
    }
  });

  // Mismo problema que ya se arregló en el registro: `normalizeDpi` acepta
  // separadores, así que sin normalizar la importación guardaba en `users.dpi`
  // una cadena distinta de los 13 dígitos que usa el resto del sistema.
  it("normaliza el DPI con separadores antes de guardarlo", async () => {
    filasSelect = [[], []];

    const res = await importar([
      { nombre: "Ana Pérez", dpi: "1234-56789-0123", correo: "ana@example.com" },
    ]);
    const cuerpo = (await res.json()) as { exitosos: number };

    expect(cuerpo.exitosos).toBe(1);
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
