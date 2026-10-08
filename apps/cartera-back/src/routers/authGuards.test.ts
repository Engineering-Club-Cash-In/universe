import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { lockPoolMock } from "../utils/testMocks";

// ─────────────────────────────────────────────────────────────────────────────
// Candados de autenticación de cartera-back.
//
// `authRouter` era un `new Elysia()` sin `authMiddleware`: cualquiera, sin
// token, podía crearse un ADMIN (`POST /auth/admin`), cambiarle la contraseña a
// cualquier usuario (`POST /auth/conta/update?contaId=<id>`) o bajarse la tabla
// de usuarios con `password_hash` incluido (`GET /auth/platform-users`). Además
// el login no miraba `is_active`, y refresh/verify renovaban tokens de usuarios
// ya desactivados para siempre.
//
// Mismo montaje que `rubrosGuards.test.ts`: sólo se mockea "../database" con un
// motor manejado por COLA. Con la cola agotada la consulta RECHAZA, así que una
// ruta que no debía llegar a la base pero llega responde 500 y no 401/403.
// ─────────────────────────────────────────────────────────────────────────────

// `@cci/email` revienta al importarse sin clave (lo importa `default.ts`). Clave
// falsa a propósito: ninguna ruta probada acá debe llegar a mandar un correo.
process.env.RESEND_API_KEY ||= "re_test_only";
process.env.EMAIL_DOMAIN ||= "example.invalid";

// Los secretos quedan DEFINIDOS (con el mismo valor que el fallback del código,
// así no cambia nada para otros archivos de test): si el router leyera una
// variable sin definir, `jwt.verify` reventaría y el refresh de un usuario
// inactivo daría 401 "por accidente", sin probar la revalidación.
process.env.JWT_SECRET ||= "supersecreto";
process.env.JWT_REFRESH_SECRET ||= "supersecreto";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

let cola: any[][] = [];
let escritos: any[] = [];
let consultas = 0;

/**
 * Respeta la PROYECCIÓN de `db.select({...})`: si el controlador pidió columnas
 * explícitas, sólo esas vuelven. Así un `select()` pelado sobre platform_users
 * devuelve `password_hash` —como la base de verdad— y el test lo detecta.
 */
const proyectar = (filas: any[], proyeccion?: Record<string, unknown>) =>
  proyeccion
    ? filas.map((f) =>
        Object.fromEntries(Object.keys(proyeccion).map((k) => [k, f[k]]))
      )
    : filas;

const cadena = (proyeccion?: Record<string, unknown>): any => {
  const c: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          consultas++;
          return (ok: any, err: any) =>
            (cola.length
              ? Promise.resolve(proyectar(cola.shift()!, proyeccion))
              : Promise.reject(new Error("sin BD en tests"))
            ).then(ok, err);
        }
        return (...args: any[]) => {
          if (prop === "values" || prop === "set") escritos.push(args[0]);
          return c;
        };
      },
    }
  );
  return c;
};

const motor: any = {
  select: (proyeccion?: Record<string, unknown>) => cadena(proyeccion),
  insert: () => cadena(),
  update: () => cadena(),
  delete: () => cadena(),
  execute: () => Promise.reject(new Error("sin BD en tests")),
};
motor.transaction = (cb: any) => cb(motor);

mock.module("../database", () => ({
  db: motor,
  client: {},
  lockPool: lockPoolMock,
}));

const { authRouter } = await import("./auth");
const { advisorRouter } = await import("./advisor");
const { default: defaultRouter } = await import("./default");
const { creditosNuevosConAbonosRouter } = await import("./creditosNuevosConAbonos");

const app = new Elysia()
  .use(authRouter)
  .use(advisorRouter)
  .use(defaultRouter)
  .use(creditosNuevosConAbonosRouter);

const PASSWORD = "secreta-123";
const HASH = await bcrypt.hash(PASSWORD, 4);

const fila = (over: Record<string, unknown> = {}) => ({
  id: 7,
  email: "usuario@clubcashin.com",
  password_hash: HASH,
  role: "CONTA",
  is_active: true,
  asesor_id: null,
  admin_id: null,
  conta_id: 3,
  created_at: null,
  updated_at: null,
  ...over,
});

const ADMIN_ACTIVO = fila({ id: 1, role: "ADMIN", admin_id: 1, conta_id: null });

const tokenDe = (role: string, id = 1) =>
  jwt.sign({ id, email: "quien@clubcashin.com", role }, JWT_SECRET);

const pedir = (
  metodo: string,
  path: string,
  opciones: { token?: string; body?: unknown } = {}
) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}),
      },
      ...(opciones.body === undefined ? {} : { body: JSON.stringify(opciones.body) }),
    })
  );

beforeEach(() => {
  cola = [];
  escritos = [];
  consultas = 0;
});

// Cuerpos VÁLIDOS: el esquema TypeBox corre antes que el handler y un 422 de
// validación no probaría nada del candado.
const NUEVO_ADMIN = {
  nombre: "Mala",
  apellido: "Persona",
  email: "atacante@example.com",
  password: "tomada",
};
const NUEVO_CONTA = { nombre: "Conta", email: "conta@example.com", password: "x" };
const NUEVO_ASESOR = { nombre: "Asesor", email: "asesor@example.com", password: "x" };

/** Rutas que crean/editan usuarios, cambian contraseñas o listan usuarios. */
const RUTAS_ADMIN: Array<[string, string, unknown?]> = [
  ["POST", "/auth/admin", NUEVO_ADMIN],
  ["POST", "/auth/conta", NUEVO_CONTA],
  ["POST", "/auth/conta/update?contaId=7", { password: "nueva" }],
  ["GET", "/auth/platform-users"],
  ["POST", "/advisor", NUEVO_ASESOR],
  ["POST", "/updateAdvisor?id=7", { password: "nueva" }],
  // Reasignar el asesor de un crédito: el dashboard Nexa acota al ASESOR por
  // `creditos.asesor_id`, así que un ASESOR no puede meterse créditos ajenos.
  ["POST", "/updateCreditAdvisor", { credito_id: 10, nombre_asesor: "Asesor" }],
  // Diagnósticos que mandan correos (uno adjunta la liquidación de un
  // inversionista a cualquier dirección) o exponen créditos.
  ["GET", "/test-email?email=atacante@example.com"],
  ["GET", "/test-email-r2?investor_id=1&email=atacante@example.com"],
  ["GET", "/test-email-credit?email=atacante@example.com"],
  ["GET", "/creditos-nuevos-con-abonos"],
  ["GET", "/creditos-nuevos-con-abonos/diagnostico"],
];

describe("Rutas administrativas — sin token responden 401 y no tocan la base", () => {
  for (const [metodo, path, body] of RUTAS_ADMIN) {
    it(`${metodo} ${path}`, async () => {
      const res = await pedir(metodo, path, { body });
      expect(res.status).toBe(401);
      expect(consultas).toBe(0);
      expect(escritos).toEqual([]);
    });
  }
});

describe("Lo público sigue público", () => {
  it("GET / (raíz del servicio) responde sin token", async () => {
    const res = await pedir("GET", "/");
    expect(res.status).toBe(200);
  });
});

describe("Rutas administrativas — token no-ADMIN responde 403", () => {
  for (const role of ["CONTA", "ASESOR", "INVESTOR"]) {
    for (const [metodo, path, body] of RUTAS_ADMIN) {
      it(`${role}: ${metodo} ${path}`, async () => {
        const res = await pedir(metodo, path, { token: tokenDe(role), body });
        expect(res.status).toBe(403);
        expect(consultas).toBe(0);
        expect(escritos).toEqual([]);
      });
    }
  }
});

describe("Rutas administrativas — el ADMIN se revalida contra la base", () => {
  it("ADMIN desactivado (token todavía vivo) → 401 y no escribe", async () => {
    cola = [[{ ...ADMIN_ACTIVO, is_active: false }]];
    const res = await pedir("POST", "/auth/conta/update?contaId=7", {
      token: tokenDe("ADMIN"),
      body: { password: "nueva" },
    });
    expect(res.status).toBe(401);
    expect(escritos).toEqual([]);
  });

  it("token dice ADMIN pero en la base ya no lo es → 403", async () => {
    cola = [[{ ...ADMIN_ACTIVO, role: "CONTA" }]];
    const res = await pedir("GET", "/auth/platform-users", { token: tokenDe("ADMIN") });
    expect(res.status).toBe(403);
  });

  it("usuario del token ya no existe → 401", async () => {
    cola = [[]];
    const res = await pedir("GET", "/auth/platform-users", { token: tokenDe("ADMIN") });
    expect(res.status).toBe(401);
  });
});

describe("POST /updateCreditAdvisor — rol vigente en la base", () => {
  const CUERPO = { credito_id: 10, nombre_asesor: "Asesor" };
  const llamar = (token: string) =>
    pedir("POST", "/updateCreditAdvisor", { token, body: CUERPO });

  it("ADMIN activo → 200 y escribe el asesor del crédito", async () => {
    cola = [
      [ADMIN_ACTIVO], // revalidación del ADMIN
      [{ asesores: { asesor_id: 4, nombre: "Asesor" }, platform_users: {} }],
      [{ credito_id: 10, asesor_id: 4 }], // update ... returning
    ];
    const res = await llamar(tokenDe("ADMIN"));
    expect(res.status).toBe(200);
    expect(escritos).toEqual([{ asesor_id: 4 }]);
  });

  it("ADMIN desactivado (token todavía vivo) → 401 y no escribe", async () => {
    cola = [[{ ...ADMIN_ACTIVO, is_active: false }]];
    expect((await llamar(tokenDe("ADMIN"))).status).toBe(401);
    expect(escritos).toEqual([]);
  });

  it("token dice ADMIN pero en la base ya es ASESOR → 403 y no escribe", async () => {
    cola = [[{ ...ADMIN_ACTIVO, role: "ASESOR" }]];
    expect((await llamar(tokenDe("ADMIN"))).status).toBe(403);
    expect(escritos).toEqual([]);
  });

  it("si la base falla al revalidar, NO pasa (falla cerrado)", async () => {
    cola = []; // la consulta rechaza
    expect((await llamar(tokenDe("ADMIN"))).status).toBe(500);
    expect(escritos).toEqual([]);
  });
});

describe("ADMIN activo — las rutas funcionan", () => {
  it("GET /auth/platform-users → 200 y NUNCA devuelve password_hash", async () => {
    cola = [
      [ADMIN_ACTIVO], // revalidación del ADMIN
      [
        ADMIN_ACTIVO,
        fila({ id: 8, role: "ASESOR", asesor_id: 4, conta_id: null }),
        fila({ id: 7 }),
      ],
      [{ asesor_id: 4, nombre: "Asesor" }], // perfil del asesor
      [{ conta_id: 3, nombre: "Conta" }], // perfil del conta
    ];
    const res = await pedir("GET", "/auth/platform-users", { token: tokenDe("ADMIN") });
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain("password_hash");
    expect(texto).not.toContain(HASH);
    const json = JSON.parse(texto);
    expect(json.data).toHaveLength(2); // sin admins
    expect(json.data.map((u: any) => u.id)).toEqual([8, 7]);
    expect(json.data[0]).toMatchObject({ role: "ASESOR", is_active: true, profile: { nombre: "Asesor" } });
  });

  it("POST /auth/conta/update → 200 y escribe el hash nuevo", async () => {
    cola = [
      [ADMIN_ACTIVO], // revalidación
      [fila({ id: 7 })], // usuario destino (CONTA)
      [], // update platform_users
    ];
    const res = await pedir("POST", "/auth/conta/update?contaId=7", {
      token: tokenDe("ADMIN"),
      body: { password: "nueva-clave" },
    });
    expect(res.status).toBe(200);
    expect(escritos).toHaveLength(1);
    expect(await bcrypt.compare("nueva-clave", escritos[0].password_hash)).toBe(true);
  });

  it("POST /auth/conta/update NO toca a un usuario que no es CONTA", async () => {
    cola = [[ADMIN_ACTIVO], [fila({ id: 1, role: "ADMIN", conta_id: null })]];
    const res = await pedir("POST", "/auth/conta/update?contaId=1", {
      token: tokenDe("ADMIN"),
      body: { password: "nueva-clave" },
    });
    expect(res.status).not.toBe(200);
    expect(escritos).toEqual([]);
  });

  it("POST /auth/admin → 201", async () => {
    cola = [[ADMIN_ACTIVO], [{ admin_id: 9, nombre: "Nuevo" }], []];
    const res = await pedir("POST", "/auth/admin", { token: tokenDe("ADMIN"), body: NUEVO_ADMIN });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toEqual({ admin_id: 9, nombre: "Nuevo" });
  });
});

describe("POST /auth/login", () => {
  it("usuario activo con clave correcta → 200, sin password_hash en la respuesta", async () => {
    cola = [[fila()]];
    const res = await pedir("POST", "/auth/login", {
      body: { email: "usuario@clubcashin.com", password: PASSWORD },
    });
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain("password_hash");
    expect(texto).not.toContain(HASH);
    const json = JSON.parse(texto);
    expect(json.data.accessToken).toBeString();
    expect(json.data.user).toMatchObject({ id: 7, role: "CONTA" });
  });

  it("usuario INACTIVO con clave correcta → 401 con el mismo mensaje genérico", async () => {
    cola = [[fila({ is_active: false })]];
    const res = await pedir("POST", "/auth/login", {
      body: { email: "usuario@clubcashin.com", password: PASSWORD },
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: "Credenciales inválidas" });
  });

  it("clave incorrecta → 401 genérico", async () => {
    cola = [[fila()]];
    const res = await pedir("POST", "/auth/login", {
      body: { email: "usuario@clubcashin.com", password: "otra" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Credenciales inválidas" });
  });

  it("email inexistente → 401 genérico", async () => {
    cola = [[]];
    const res = await pedir("POST", "/auth/login", {
      body: { email: "nadie@clubcashin.com", password: PASSWORD },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Credenciales inválidas" });
  });

  it("usuario de sistema (hash no-bcrypt, inactivo) → 401 genérico, sin filtrar el error de bcrypt", async () => {
    cola = [[fila({ password_hash: "!sin-login-usuario-de-sistema", is_active: false })]];
    const res = await pedir("POST", "/auth/login", {
      body: { email: "sistema-nexa@clubcashin.local", password: "!sin-login-usuario-de-sistema" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Credenciales inválidas" });
  });
  it("hash no-bcrypt: igual compara contra el señuelo (mismo tiempo que un email inexistente) y rechaza", async () => {
    const compare = spyOn(bcrypt, "compare");
    try {
      cola = [[fila({ password_hash: "!sin-login-usuario-de-sistema", is_active: true })]];
      const res = await pedir("POST", "/auth/login", {
        body: { email: "sistema-nexa@clubcashin.local", password: "!sin-login-usuario-de-sistema" },
      });
      expect(res.status).toBe(401);
      expect(compare.mock.calls.map((c) => c[1])).toEqual([
        "$2b$10$htxlG0Bp9OdXlrHtRS4HxOwTBczPRqqVG4n2QTYOyk7m35qCsy44a",
      ]);
    } finally {
      compare.mockRestore();
    }
  });
});

describe("Renovación de tokens — un usuario desactivado ya no renueva", () => {
  const refreshDe = (id = 7, role = "CONTA") =>
    jwt.sign({ id, email: "usuario@clubcashin.com", role }, JWT_REFRESH_SECRET, { expiresIn: "7d" });

  it("POST /auth/refresh de usuario activo → 200 con el rol VIGENTE de la base", async () => {
    cola = [[fila({ role: "ASESOR", asesor_id: 4, conta_id: null })]];
    const res = await pedir("POST", "/auth/refresh", { body: { refreshToken: refreshDe(7, "ADMIN") } });
    expect(res.status).toBe(200);
    const json = await res.json();
    const decoded = jwt.verify(json.accessToken, JWT_SECRET) as any;
    expect(decoded.role).toBe("ASESOR");
    expect(json.refreshToken).toBeString();
  });

  it("POST /auth/refresh de usuario INACTIVO → 401", async () => {
    cola = [[fila({ is_active: false })]];
    const res = await pedir("POST", "/auth/refresh", { body: { refreshToken: refreshDe() } });
    expect(res.status).toBe(401);
  });

  it("POST /auth/refresh de usuario borrado → 401", async () => {
    cola = [[]];
    const res = await pedir("POST", "/auth/refresh", { body: { refreshToken: refreshDe() } });
    expect(res.status).toBe(401);
  });

  it("POST /auth/refresh con firma inválida → 401", async () => {
    const res = await pedir("POST", "/auth/refresh", { body: { refreshToken: "no-es-un-jwt" } });
    expect(res.status).toBe(401);
  });

  it("GET /auth/verify de usuario activo → 200 y token renovado", async () => {
    cola = [[fila()]];
    const res = await pedir("GET", `/auth/verify?token=${tokenDe("CONTA", 7)}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ id: 7, role: "CONTA" });
    expect(json.accessToken).toBeString();
  });

  it("GET /auth/verify de usuario INACTIVO → 401", async () => {
    cola = [[fila({ is_active: false })]];
    const res = await pedir("GET", `/auth/verify?token=${tokenDe("CONTA", 7)}`);
    expect(res.status).toBe(401);
  });
});
