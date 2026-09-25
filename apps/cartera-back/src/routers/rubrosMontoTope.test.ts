import { describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import Big from "big.js";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { lockPoolMock } from "../utils/testMocks";

// ─────────────────────────────────────────────────────────────────────────────
// El tope del monto: el ESQUEMA y la POLICY tienen que juzgar el MISMO número.
//
// `puedeUsarMonto` redondea a la escala de la columna ANTES de comparar contra
// el tope —"se valida y se guarda el mismo número", el invariante por el que
// existe `redondearMonto`, nacido del rubro de Q0 que entró con `monto: 0.004`—,
// pero el `maximum` del esquema TypeBox miraba el valor CRUDO. O sea que
// `99999999.994`, que la policy acepta porque se guardaría como "99999999.99",
// moría en un 400 por una milésima que nunca iba a existir en la columna: dos
// jueces, dos números, dos veredictos.
//
// Estos casos afirman la EQUIVALENCIA, no el status de cada uno por separado:
// lo que la policy permite cruza el esquema, y lo que rechaza recibe 400. Así
// el test sigue sirviendo si mañana cambia el tope o la escala.
//
// Se monta el mismo sándwich que `rubrosContrato400.test.ts` —middleware global
// primero, router después— porque lo que se mira son códigos de respuesta, y el
// 400 de rubros sólo existe si el `onError` del router llega a correr.
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

/**
 * Motor de base ENCADENABLE que rechaza al primer `await`.
 *
 * Tiene que ser encadenable —y no el proxy de una sola llamada de
 * `rubrosContrato400.test.ts`— porque acá la mitad de los casos SÍ cruzan la
 * validación y llegan al controlador, que hace `db.select().from().where()`:
 * con el proxy simple eso revienta con un `TypeError` sincrónico que el handler
 * no distingue del rechazo, y el test se cae por el andamio en vez de por la
 * regla. Rechazar en el `await` deja al handler caer en su propio catch y
 * responder 500, que es la señal limpia de "pasó el esquema".
 */
const motorQueRechaza = (): any => {
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") {
          return (ok: any, err: any) =>
            Promise.reject(new Error("sin BD en tests")).then(ok, err);
        }
        return () => eslabon;
      },
    }
  );
  return eslabon;
};

// La base RECHAZA todo: el monto que cruza el esquema muere más adelante con el
// 500 del handler, y ese 500 es justamente la señal de "pasó la validación".
mock.module("../database", () => ({
  db: motorQueRechaza(),
  client: {},
  // Va aunque acá no se use: `mock.module` reemplaza el módulo ENTERO, y sin
  // esta clave el `import { lockPool }` de `paymentAdvisoryLock.ts` revienta el
  // archivo al cargarse. Mismo motivo que en `rubrosContrato400.test.ts`.
  lockPool: lockPoolMock,
}));

const { rubrosRouter } = await import("./rubros");
const { validationErrorMiddleware } = await import(
  "../middleware/validationError"
);
const { puedeUsarMonto, MONTO_MAXIMO_RUBRO } = await import(
  "../controllers/rubrosPolicy"
);

const app = new Elysia().use(validationErrorMiddleware).use(rubrosRouter);

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
      // El body se arma a mano y no con `JSON.stringify`: un monto como
      // `1e400` es Infinity en JS y `JSON.stringify` lo escribe como `null`,
      // que es OTRO caso (falta el campo) y no el que se quiere probar.
      body,
    })
  );

/** El tope en crudo y el primer valor que ya NO redondea hacia él. */
const tope = new Big(MONTO_MAXIMO_RUBRO);
const casos: Array<[string, string]> = [
  ["el tope exacto", tope.toFixed(2)],
  // El corazón del asunto: cuatro milésimas de más que se pierden al redondear.
  ["una fracción que redondea AL tope", tope.plus("0.004").toFixed(3)],
  // Medio centavo: con redondeo half-up ya sube al siguiente centavo, así que
  // se guardaría por encima del tope y tiene que caer.
  ["medio centavo de más", tope.plus("0.005").toFixed(3)],
  ["un centavo de más", tope.plus("0.01").toFixed(2)],
  ["un monto que desborda la columna", "1e16"],
  // JSON admite `1e400` y `JSON.parse` lo entrega como Infinity: un número
  // para JavaScript, pero `new Big(Infinity)` tira. Tiene que morir en el
  // esquema, nunca en la policy.
  ["un exponente fuera del rango de un double", "1e400"],
];

describe("Rubros — el esquema del monto y la policy juzgan el mismo número", () => {
  for (const [nombre, crudo] of casos) {
    it(`POST /rubros coincide con puedeUsarMonto: ${nombre} (${crudo})`, async () => {
      const laPolicyLoPermite = puedeUsarMonto(
        // El valor viaja por HTTP como número JSON; se juzga en la policy el
        // mismo texto que va en el body.
        crudo
      ).permitido;

      const res = await pedir(
        "POST",
        "/rubros",
        `{"credito_id":1,"tipo_id":1,"monto":${crudo},"descripcion":"prueba"}`
      );

      // 400 = lo cortó el esquema. Cualquier otra cosa = cruzó y siguió.
      const loCortoElEsquema = res.status === 400;
      expect(loCortoElEsquema).toBe(!laPolicyLoPermite);
    });
  }

  it("PUT /rubros/:id usa el mismo tope que el alta", async () => {
    const queRedondeaAlTope = tope.plus("0.004").toFixed(3);
    expect(puedeUsarMonto(queRedondeaAlTope).permitido).toBe(true);

    const res = await pedir(
      "PUT",
      "/rubros/1",
      `{"monto":${queRedondeaAlTope},"motivo":"corrección"}`
    );
    expect(res.status).not.toBe(400);
  });
});
