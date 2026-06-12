import { describe, expect, test } from "bun:test";
import { createTokenUserForCredit } from "./service";

describe("createTokenUserForCredit", () => {
  test("uses the next local sequence as a padded identifier and stores Nexa's token", async () => {
    const created = await createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_002,
        createTokenUser: async (user) => ({ id: 11, ...user }),
      },
      nexa: {
        createTokenUsers: async (payload) => {
          expect(payload).toEqual({
            tokenId: 5,
            users: [{ identifier: 100_000_002, description: "Credito 42", nationalId: 1234567890101 }],
          });
          return { users: [{ id: 99, token: "32200100000002" }], errorUsers: [] };
        },
      },
    });

    expect(created).toMatchObject({
      creditoId: 42,
      identifier: "100000002",
      token: "32200100000002",
      nexaUserId: 99,
    });
  });

  test("fails when Nexa rejects the generated user", async () => {
    await expect(createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_002,
        createTokenUser: async (user) => ({ id: 11, ...user }),
      },
      nexa: {
        createTokenUsers: async () => ({ users: [], errorUsers: [{ identifier: 100_000_002, reason: "duplicado" }] }),
      },
    })).rejects.toThrow("Nexa rejected token user 100000002: duplicado");
  });
});
