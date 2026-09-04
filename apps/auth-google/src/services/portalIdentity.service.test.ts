import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Renderiza un predicado de Drizzle a SQL legible, para poder afirmar sobre él
// sin comparar árboles enormes.
const dialecto = new PgDialect();
const aSql = (condicion: unknown) => dialecto.sqlToQuery(condicion as SQL);

// Filas que devuelve el `select`, en orden de consulta.
let filasSelect: Record<string, unknown>[][] = [];
// Predicado de cada SELECT, para poder afirmar sobre la exclusión que aplica.
let selects: unknown[] = [];
// Fuerza el choque contra el índice único en el siguiente UPDATE.
let updateChocaConElIndice = false;
// Cada UPDATE que hizo el servicio: qué escribió y bajo qué predicado.
let updates: { valores: Record<string, unknown>; condicion: unknown }[] = [];
// Filas que devuelve el `returning` del UPDATE de rol. Vacío = el predicado no
// casó con ninguna fila, es decir, se perdió la carrera.
let filasActualizadas: Record<string, unknown>[] = [];

mock.module("../db/connection", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condicion: unknown) => {
          selects.push(condicion);
          return Promise.resolve(filasSelect.shift() ?? []);
        },
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: (condicion: unknown) => {
          updates.push({ valores, condicion });

          if (updateChocaConElIndice) {
            const fallo = Object.assign(
              new Error(
                'duplicate key value violates unique constraint "users_dpi_unique"',
              ),
              { code: "23505" },
            );
            const rechazo = Promise.reject(fallo);
            return Object.assign(rechazo, { returning: () => rechazo });
          }

          // El builder de Drizzle es encadenable y "thenable" a la vez: se
          // puede await directamente o pedirle `.returning()`.
          const resultado = Promise.resolve(filasActualizadas);
          return Object.assign(resultado, {
            returning: () => Promise.resolve(filasActualizadas),
          });
        },
      }),
    }),
  },
}));

// Se carga dentro de `beforeAll` para que el mock de la conexión ya esté puesto.
let applyRegistrationOutcome: (typeof import("./portalIdentity.service"))["applyRegistrationOutcome"];
let assertDpiAvailable: (typeof import("./portalIdentity.service"))["assertDpiAvailable"];
let setUserDpi: (typeof import("./portalIdentity.service"))["setUserDpi"];
let DpiAlreadyTakenError: (typeof import("./portalIdentity.service"))["DpiAlreadyTakenError"];

beforeAll(async () => {
  const servicio = await import("./portalIdentity.service");

  applyRegistrationOutcome = servicio.applyRegistrationOutcome;
  assertDpiAvailable = servicio.assertDpiAvailable;
  setUserDpi = servicio.setUserDpi;
  DpiAlreadyTakenError = servicio.DpiAlreadyTakenError;
});

describe("applyRegistrationOutcome", () => {
  beforeEach(() => {
    filasSelect = [];
    selects = [];
    updates = [];
    filasActualizadas = [{ id: "u1" }];
    updateChocaConElIndice = false;
  });

  it("asciende a INVESTOR una cuenta que sigue siendo CLIENT", async () => {
    filasSelect = [[{ id: "u1", role: "CLIENT", dpi: "1234567890123" }]];

    const resultado = await applyRegistrationOutcome(
      "u1",
      "INVESTOR",
      "1234567890123",
    );

    expect(resultado.role).toBe("INVESTOR");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.valores.role).toBe("INVESTOR");
  });

  // El hueco: entre el SELECT y el UPDATE median comprobaciones y escrituras de
  // DPI. Si en esa ventana un administrador asciende la cuenta, un predicado
  // que solo casa por id le pisa el rol nuevo con INVESTOR.
  it("condiciona el UPDATE al rol que leyó, no solo al id", async () => {
    filasSelect = [[{ id: "u1", role: "CLIENT", dpi: "1234567890123" }]];

    await applyRegistrationOutcome("u1", "INVESTOR", "1234567890123");

    const predicado = aSql(updates[0]!.condicion);

    expect(predicado.sql).toContain('"role"');
    expect(predicado.params).toEqual(["u1", "CLIENT"]);
  });

  it("no reporta ascenso si perdió la carrera contra el cambio de rol", async () => {
    filasSelect = [[{ id: "u1", role: "CLIENT", dpi: "1234567890123" }]];
    filasActualizadas = [];

    const resultado = await applyRegistrationOutcome(
      "u1",
      "INVESTOR",
      "1234567890123",
    );

    expect(resultado.role).toBeNull();
  });

  it("no toca un rol administrativo", async () => {
    filasSelect = [[{ id: "u1", role: "ADMIN", dpi: "1234567890123" }]];

    const resultado = await applyRegistrationOutcome(
      "u1",
      "INVESTOR",
      "1234567890123",
    );

    expect(resultado.role).toBeNull();
    expect(updates).toEqual([]);
  });
});

// Aquí vivían `claimDpi` y `releaseDpiClaim`: una reserva ESCRITA del DPI antes
// del alta externa, con su liberación y su compare-and-set. Existían para hacer
// recuperable la orquestación entre los tres sistemas, y nunca llegaron a ser
// correctas —dos peticiones de la MISMA cuenta con el MISMO DPI seguían pudiendo
// borrarse la identidad entre ellas, porque comparar solo el DPI no identifica
// qué petición es dueña de la reserva.
//
// Se borraron al volver idempotente la única escritura externa que importa: el
// alta en cartera. Lo que queda es una comprobación barata para el caso común;
// la exclusión de verdad la dan los índices únicos.
describe("assertDpiAvailable", () => {
  beforeEach(() => {
    filasSelect = [];
    selects = [];
    updates = [];
    updateChocaConElIndice = false;
  });

  it("excluye la propia cuenta al buscar el DPI", async () => {
    // Sin excluirse a sí misma, un reintento del titular choca contra el DPI
    // que él mismo dejó escrito en un intento anterior y no puede terminar.
    filasSelect = [[]];

    await assertDpiAvailable("u1", "1234567890123");

    const predicado = aSql(selects[0]);

    expect(predicado.sql).toContain('"id" <>');
    expect(predicado.params).toEqual(["1234567890123", "u1"]);
  });

  it("rechaza un DPI que ya tiene otra cuenta", async () => {
    filasSelect = [[{ id: "otra-cuenta" }]];

    await expect(assertDpiAvailable("u1", "1234567890123")).rejects.toThrow(
      DpiAlreadyTakenError,
    );
  });
});

describe("setUserDpi", () => {
  beforeEach(() => {
    filasSelect = [];
    selects = [];
    updates = [];
    filasActualizadas = [{ id: "u1" }];
    updateChocaConElIndice = false;
  });

  // El SELECT de `assertDpiAvailable` no excluye a una petición simultánea, así
  // que la escritura puede chocar igual. Ese choque es la exclusión REAL, y
  // tiene que llegar al titular como el mismo 409 que puede corregir, no como un
  // 500 mudo con el registro externo ya hecho.
  it("traduce el choque contra el índice único al mismo conflicto de DPI", async () => {
    filasSelect = [[]];
    updateChocaConElIndice = true;

    await expect(setUserDpi("u1", "1234567890123")).rejects.toThrow(
      DpiAlreadyTakenError,
    );
  });
});
