import { beforeEach, describe, expect, it, mock } from "bun:test";

const existingInvestor = {
  inversionista_id: 10,
  nombre: "Isabella Sanchez",
  dpi: 1234567890101,
  email: "isabella@example.com",
};

let selectResponses: unknown[][] = [];
let updateWasCalled = false;

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
            returning: () => Promise.resolve([{ ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." }]),
          }),
        }),
      };
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  },
}));

mock.module("@cci/email", () => ({
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
}));

mock.module("./addInvestorToCredit", () => ({
  addInvestorToCredit: mock(() => Promise.resolve()),
}));

const { insertInvestor } = await import("./investor");

describe("insertInvestor", () => {
  beforeEach(() => {
    selectResponses = [];
    updateWasCalled = false;
  });

  it("rechaza crear un inversionista con email ya usado por otro inversionista", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
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
  });
});
