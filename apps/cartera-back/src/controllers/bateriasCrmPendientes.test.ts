import { beforeEach, describe, expect, mock, test } from "bun:test";

/** Lo que devuelve la consulta de pendientes. */
let pendientes: Array<Record<string, unknown>> = [];
/** Lo que se le escribió a cada fila. */
const escrituras: Array<Record<string, unknown>> = [];
/** Quiénes contesta bien el CRM. */
let aceptaElCrm = new Set<number>();

mock.module("../database", () => ({
  client: {},
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => pendientes }),
        }),
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: async () => {
          escrituras.push(valores);
        },
      }),
    }),
  },
}));

mock.module("../services/crm.service", () => ({
  abrirBateriaDeContratosEnCrm: async (payload: { inversionista: { id: number } }) =>
    aceptaElCrm.has(payload.inversionista.id)
      ? { success: true, batchId: "bateria" }
      : { success: false, error: "CRM caído" },
}));

const { reintentarBateriasPendientes } = await import("./bateriasCrmPendientes");

const pendiente = (id: number, inversionista: number, intentos = 1) => ({
  id,
  inversionista_id: inversionista,
  payload: { inversionista: { id: inversionista, nombre: `inv-${inversionista}` } },
  intentos,
});

beforeEach(() => {
  pendientes = [];
  escrituras.length = 0;
  aceptaElCrm = new Set();
});

describe("reintento de avisos al CRM", () => {
  test("el que el CRM recibe queda enviado; el que no, suma un intento", async () => {
    pendientes = [pendiente(1, 10), pendiente(2, 20)];
    aceptaElCrm = new Set([10]);

    const resultado = await reintentarBateriasPendientes();

    expect(resultado).toEqual({ enviados: 1, fallidos: 1 });
    expect(escrituras[0]).toHaveProperty("enviado_at");
    expect(escrituras[1]).toMatchObject({ ultimo_error: "CRM caído" });
    expect(escrituras[1]).toHaveProperty("intentos");
  });

  test("sin pendientes no hace nada", async () => {
    expect(await reintentarBateriasPendientes()).toEqual({
      enviados: 0,
      fallidos: 0,
    });
    expect(escrituras).toHaveLength(0);
  });
});
