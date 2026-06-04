import { beforeEach, describe, expect, it, mock } from "bun:test";

const existingInvestor = {
  inversionista_id: 10,
  nombre: "Isabella Sanchez",
  dpi: 1234567890101,
  email: "isabella@example.com",
};

let selectResponses: unknown[][] = [];
let updateWasCalled = false;
let insertWasCalled = false;

mock.module("../database/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResponses.shift() ?? []),
        }),
      }),
    }),
    update: () => {
      updateWasCalled = true;
      return {
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                { ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." },
              ]),
          }),
        }),
      };
    },
    insert: () => {
      insertWasCalled = true;
      return {
        values: () => ({
          returning: () => Promise.resolve([]),
        }),
      };
    },
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

const { insertInvestor } = await import("./investor");

describe("insertInvestor", () => {
  beforeEach(() => {
    selectResponses = [];
    updateWasCalled = false;
    insertWasCalled = false;
  });

  it("rechaza operation CREATE con email ya usado por otro inversionista", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(set.status).toBe(409);
    expect(result).toEqual({
      message: "Ya existe un inversionista con ese email",
      error: "duplicate_email",
    });
    expect(updateWasCalled).toBeFalse();
    expect(insertWasCalled).toBeFalse();
  });

  it("conserva upsert legacy por email cuando no viene operation ni mode", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(set.status).toBe(201);
    expect(result.data).toEqual([
      { ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." },
    ]);
    expect(updateWasCalled).toBeTrue();
    expect(insertWasCalled).toBeFalse();
  });

  it("edita exclusivamente por inversionista_id cuando viene el ID", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(set.status).toBe(201);
    expect(result.data).toEqual([
      { ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." },
    ]);
    expect(updateWasCalled).toBeTrue();
    expect(insertWasCalled).toBeFalse();
  });
});
