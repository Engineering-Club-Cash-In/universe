/**
 * Búsqueda de inversionista por correo.
 *
 * `inversionistas.email` no es único: en producción hay correos compartidos por
 * dos inversionistas distintos (89 Autocash y 97 Blokfund comparten
 * richardkachler@sepresta.com). La consulta no lleva ORDER BY ni LIMIT, así que
 * cuál sale primero depende del plan de ejecución y puede voltearse con un
 * índice nuevo o un VACUUM. Por eso la respuesta informa cuántos coincidieron:
 * es lo que le permite al portal negarse a escribir en vez de acertar por
 * casualidad (ver `findInvestorByEmail` en auth-google).
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

import { lockPoolMock } from "../utils/testMocks";

let filas: unknown[] = [];

mock.module("../database/index", () => ({
  client: {},
  lockPool: lockPoolMock,
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(filas),
        }),
      }),
    }),
  },
}));

mock.module("@cci/email", () => ({
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

mock.module("./addInvestorToCredit", () => ({
  addInvestorToCredit: mock(() => Promise.resolve()),
}));

const { getInvestors } = await import("./investor");

const fila = (inversionista: Record<string, unknown>) => ({
  inversionista,
  documento: null,
});

const autocash = {
  inversionista_id: 89,
  nombre: "Autocash",
  email: "richardkachler@sepresta.com",
};
const blokfund = {
  inversionista_id: 97,
  nombre: "Blokfund",
  email: "richardkachler@sepresta.com",
};

describe("getInvestors por email", () => {
  beforeEach(() => {
    filas = [];
  });

  it("informa una sola coincidencia cuando el correo identifica a uno", async () => {
    filas = [fila(autocash)];
    const set = { status: 0 };

    const result = await getInvestors({
      query: { email: autocash.email },
      set,
    });

    expect(set.status).toBe(200);
    expect(result.inversionista_id).toBe(89);
    expect(result.coincidencias_email).toBe(1);
  });

  it("delata el correo compartido por varios inversionistas", async () => {
    filas = [fila(autocash), fila(blokfund)];
    const set = { status: 0 };

    const result = await getInvestors({
      query: { email: autocash.email },
      set,
    });

    expect(set.status).toBe(200);
    expect(result.coincidencias_email).toBe(2);
  });

  it("cuenta inversionistas, no filas: varios documentos no son ambigüedad", async () => {
    // El left join con documentos multiplica las filas del mismo inversionista.
    filas = [fila(autocash), fila(autocash)];
    const set = { status: 0 };

    const result = await getInvestors({
      query: { email: autocash.email },
      set,
    });

    expect(result.coincidencias_email).toBe(1);
  });

  it("sigue devolviendo 404 cuando el correo no existe", async () => {
    filas = [];
    const set = { status: 0 };

    const result = await getInvestors({
      query: { email: "nadie@example.com" },
      set,
    });

    expect(set.status).toBe(404);
    expect(result.coincidencias_email).toBeUndefined();
  });
});
