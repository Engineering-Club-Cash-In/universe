import { describe, expect, test } from "bun:test";
import { createTokenUserForCredit, TokenUserReconciliationRequiredError } from "./service";

describe("createTokenUserForCredit", () => {
  test("uses the next local sequence as a padded identifier and stores Nexa's token", async () => {
    const created = await createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_002,
        reserveIdentifier: async (_creditoId: number, next: () => Promise<string>) => ({ identifier: await next() }),
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
        reserveIdentifier: async (_creditoId: number, next: () => Promise<string>) => ({ identifier: await next() }),
        createTokenUser: async (user) => ({ id: 11, ...user }),
      },
      nexa: {
        createTokenUsers: async () => ({ users: [], errorUsers: [{ identifier: 100_000_002, reason: "duplicado" }] }),
      },
    })).rejects.toThrow("Nexa rejected token user 100000002: duplicado");
  });

  test("registra prefijo + identificador aunque Nexa devuelva otro token", async () => {
    const original = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
    try {
      const created = await createTokenUserForCredit({
        creditoId: 42,
        description: "Credito 42",
        nationalId: "1234567890101",
        paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
        repository: {
          nextIdentifierSequence: async () => 100_000_002,
          reserveIdentifier: async (_creditoId: number, next: () => Promise<string>) => ({ identifier: await next() }),
          createTokenUser: async (user) => ({ id: 11, ...user }),
        },
        nexa: {
          createTokenUsers: async () => ({ users: [{ id: 99, token: "32200999999999" }], errorUsers: [] }),
        },
      });
      expect(created.token).toBe("32200100000002");
      const log = logged.join("\n");
      expect(log).toContain("credito 42");
      expect(log).toContain("identifier 100000002");
      expect(log).toContain("**********9999");
      expect(log).toContain("**********0002");
      // Ninguno de los dos tokens completos llega al log.
      expect(log).not.toContain("32200999999999");
      expect(log).not.toContain("32200100000002");
    } finally {
      console.error = original;
    }
  });

  test("returns the already stored token when another request saved one first", async () => {
    const created = await createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_003,
        reserveIdentifier: async (_creditoId: number, next: () => Promise<string>) => ({ identifier: await next() }),
        // onConflictDoNothing → el repositorio devuelve la fila que ya estaba.
        createTokenUser: async () => ({
          id: 10,
          paymentTokenId: 7,
          creditoId: 42,
          identifier: "100000002",
          description: "Credito 42",
          nationalId: "1234567890101",
          nexaUserId: 98,
          token: "32200100000002",
        }),
      },
      nexa: {
        createTokenUsers: async () => ({ users: [{ id: 99, token: "32200100000003" }], errorUsers: [] }),
      },
    });

    expect(created).toMatchObject({ creditoId: 42, identifier: "100000002", nexaUserId: 98, token: "32200100000002" });
  });

  test("a retry reuses the reserved identifier instead of asking Nexa for a new user", async () => {
    let sequenceCalls = 0;
    let sentIdentifier = 0;
    const created = await createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => {
          sequenceCalls += 1;
          return 100_000_009;
        },
        // El primer intento ya reservó 100000002 y se cayó al guardar.
        reserveIdentifier: async () => ({ identifier: "100000002" }),
        createTokenUser: async (user) => ({ id: 11, ...user }),
      },
      nexa: {
        createTokenUsers: async (payload) => {
          sentIdentifier = payload.users[0]!.identifier;
          return { users: [{ id: 99, token: "32200100000002" }], errorUsers: [] };
        },
      },
    });

    expect(sentIdentifier).toBe(100_000_002);
    expect(sequenceCalls).toBe(0);
    expect(created).toMatchObject({ identifier: "100000002", token: "32200100000002" });
  });

  test("finishes from the saved reservation response without calling Nexa again", async () => {
    let nexaCalls = 0;
    const stored: unknown[] = [];
    const created = await createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_009,
        // Intento anterior: Nexa respondió, se guardó en la reserva y falló el token user.
        reserveIdentifier: async () => ({ identifier: "100000002", reused: true, nexaUserId: 99, token: "32200100000002" }),
        createTokenUser: async (user) => {
          stored.push(user);
          return { id: 11, ...user };
        },
      },
      nexa: {
        createTokenUsers: async () => {
          nexaCalls += 1;
          return { users: [], errorUsers: [] };
        },
      },
    });

    expect(nexaCalls).toBe(0);
    expect(stored).toHaveLength(1);
    expect(created).toMatchObject({ identifier: "100000002", nexaUserId: 99, token: "32200100000002" });
  });

  test("saves Nexa's response in the reservation before the token user", async () => {
    const orden: string[] = [];
    await createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_002,
        reserveIdentifier: async (_c, next) => ({ identifier: await next(), reused: false }),
        saveReservationResponse: async () => {
          orden.push("reserva");
        },
        createTokenUser: async (user) => {
          orden.push("token_user");
          return { id: 11, ...user };
        },
      },
      nexa: { createTokenUsers: async () => ({ users: [{ id: 99, token: "32200100000002" }], errorUsers: [] }) },
    });
    expect(orden).toEqual(["reserva", "token_user"]);
  });

  test("a reused identifier rejected by Nexa asks for manual reconciliation instead of a new user", async () => {
    await expect(createTokenUserForCredit({
      creditoId: 42,
      description: "Credito 42",
      nationalId: "1234567890101",
      paymentToken: { id: 7, nexaTokenId: 5, prefix: "32200" },
      repository: {
        nextIdentifierSequence: async () => 100_000_009,
        reserveIdentifier: async () => ({ identifier: "100000002", reused: true, nexaUserId: null, token: null }),
        createTokenUser: async (user) => ({ id: 11, ...user }),
      },
      nexa: {
        createTokenUsers: async () => ({ users: [], errorUsers: [{ identifier: 100_000_002, reason: "Identificador duplicado" }] }),
      },
    })).rejects.toBeInstanceOf(TokenUserReconciliationRequiredError);
  });
});
