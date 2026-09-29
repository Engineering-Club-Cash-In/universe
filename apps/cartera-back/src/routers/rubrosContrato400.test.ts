import { describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { Elysia, t } from "elysia";
import jwt from "jsonwebtoken";
import { lockPoolMock } from "../utils/testMocks";

// ─────────────────────────────────────────────────────────────────────────────
// El 400 de "body malformado" que `rubros.ts` le prometió al front, probado
// SOBRE LA APP COMPUESTA.
//
// `rubrosGuards.test.ts` monta el router solo (`new Elysia().use(rubrosRouter)`)
// y ahí el `onError` del router es el único que existe, así que el 400 sale
// siempre y el test queda verde aunque en producción nadie lo vea. Pero
// `src/index.ts` monta ANTES `validationErrorMiddleware`, que responde 422 a
// todo error de validación; Elysia corta la cadena de `onError` en cuanto uno
// devuelve respuesta, así que el del router nunca llegaba a correr y el front
// recibía 422 donde esperaba 400.
//
// Por eso este archivo arma el mismo sándwich que `index.ts` —middleware
// global primero, router después— y afirma las DOS mitades del trato: rubros
// responde 400, y cualquier otra ruta sigue respondiendo el 422 de siempre.
// Esa segunda mitad es la que protege al resto de cartera-back, que comparte
// ese middleware.
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// El body malformado muere en el esquema TypeBox, antes del handler: ninguna
// de estas rutas llega a consultar. El mock existe sólo para que importar el
// router no abra una conexión de verdad.
mock.module("../database", () => ({
  db: new Proxy(
    {},
    { get: () => () => Promise.reject(new Error("sin BD en tests")) }
  ),
  client: {},
  // `lockPool` va aunque acá no se use NADA de él, y no es por las dudas:
  // reemplazar un módulo con `mock.module` lo reemplaza ENTERO, así que
  // cualquier clave que falte deja de existir para todo el que la importe. Hoy
  // `rubros.ts` todavía no toma el advisory lock, pero en cuanto lo tome —y va
  // a tomarlo: es lo que serializa la edición de un rubro contra el registro de
  // una boleta— `paymentAdvisoryLock.ts` hace `import { lockPool }` y el
  // ARCHIVO ENTERO revienta al cargarse, con un `SyntaxError` que no menciona
  // ni a este test ni a rubros. Lo mismo hace `rubrosListado.test.ts`.
  lockPool: lockPoolMock,
}));

const { rubrosRouter } = await import("./rubros");
const { validationErrorMiddleware } = await import(
  "../middleware/validationError"
);

// Un router cualquiera que NO es rubros, para vigilar que el middleware global
// siga tratando igual a todo el resto de la aplicación.
const otroRouter = new Elysia({ prefix: "/otro-modulo" }).post(
  "/algo",
  () => ({ ok: true }),
  { body: t.Object({ nombre: t.String() }) }
);

const app = new Elysia()
  .use(validationErrorMiddleware)
  .use(rubrosRouter)
  .use(otroRouter);

const token = jwt.sign(
  { id: 1, email: "quien@clubcashin.com", role: "ADMIN" },
  JWT_SECRET
);

const pedir = (metodo: string, path: string, body: any) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );

describe("Rubros — el 400 por body malformado sobrevive a la app compuesta", () => {
  // Una por método y por forma de body: el contrato es del módulo entero, no
  // de la ruta que se probó de casualidad.
  const malformados: Array<[string, string, string, any]> = [
    ["POST", "/rubros/tipos", "nombre no es texto", { nombre: 123 }],
    ["POST", "/rubros/tipos", "falta nombre", {}],
    ["PUT", "/rubros/tipos/1", "nombre no es texto", { nombre: 123 }],
    ["POST", "/rubros", "monto no es número", {
      credito_id: 1,
      tipo_id: 1,
      monto: "quinientos",
    }],
    ["POST", "/rubros", "falta credito_id", { tipo_id: 1, monto: 500 }],
    ["PUT", "/rubros/1", "monto no es número", { monto: "cuatrocientos" }],
    ["POST", "/rubros/1/anular", "motivo no es texto", { motivo: 7 }],
  ];

  for (const [metodo, path, caso, body] of malformados) {
    it(`400 en ${metodo} ${path} (${caso})`, async () => {
      const res = await pedir(metodo, path, body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.success).toBe(false);
      expect(json.message).toContain("Body inválido");
    });
  }
});

describe("El resto de cartera-back conserva su 422", () => {
  it("una ruta ajena a rubros sigue recibiendo el 422 del middleware global", async () => {
    const res = await pedir("POST", "/otro-modulo/algo", { nombre: 123 });
    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error).toContain("no es válido");
  });
});
