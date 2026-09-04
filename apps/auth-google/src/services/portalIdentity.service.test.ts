import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Renderiza un predicado de Drizzle a SQL legible, para poder afirmar sobre él
// sin comparar árboles enormes.
const dialecto = new PgDialect();
const aSql = (condicion: unknown) => dialecto.sqlToQuery(condicion as SQL);

// Filas que devuelve el `select`, en orden de consulta.
let filasSelect: Record<string, unknown>[][] = [];
// Cada UPDATE que hizo el servicio: qué escribió y bajo qué predicado.
let updates: { valores: Record<string, unknown>; condicion: unknown }[] = [];
// Filas que devuelve el `returning` del UPDATE de rol. Vacío = el predicado no
// casó con ninguna fila, es decir, se perdió la carrera.
let filasActualizadas: Record<string, unknown>[] = [];

mock.module("../db/connection", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(filasSelect.shift() ?? []),
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: (condicion: unknown) => {
          updates.push({ valores, condicion });
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

beforeAll(async () => {
  applyRegistrationOutcome = (await import("./portalIdentity.service"))
    .applyRegistrationOutcome;
});

describe("applyRegistrationOutcome", () => {
  beforeEach(() => {
    filasSelect = [];
    updates = [];
    filasActualizadas = [{ id: "u1" }];
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
