import { describe, expect, test } from "bun:test";
import { createAdminRouter } from "./admin";

describe("admin router", () => {
  test("lists token users and transactions for the test console", async () => {
    const router = createAdminRouter({
      internalApiKey: "dev-secret",
      nexa: {} as never,
      cartera: {} as never,
      paymentTokens: {} as never,
      tokenUsers: {
        list: async () => [{ id: 1, creditoId: 123, token: "32200310005010", identifier: "310005010" }],
      } as never,
      transactions: {
        list: async () => [{ id: 1, reference: "4617308", processingStatus: "APPLIED", amount: "50.00" }],
      } as never,
      mockCredits: {
        list: async () => [{ creditoId: 123, currentBalance: "950.00", installmentAmount: "250.00", totalPaid: "50.00" }],
        upsert: async (input: unknown) => input,
      } as never,
      pollRuns: {} as never,
      accumulatorAccount: 10300102824,
      paymentTokenName: "Club Cashin GTQ UAT",
    });

    const tokenUsers = await router.request("/token-users", { headers: { Authorization: "Bearer dev-secret" } });
    const transactions = await router.request("/transactions", { headers: { Authorization: "Bearer dev-secret" } });
    const credits = await router.request("/mock-credits", { headers: { Authorization: "Bearer dev-secret" } });

    expect(tokenUsers.status).toBe(200);
    expect(await tokenUsers.json()).toEqual({ tokenUsers: [{ id: 1, creditoId: 123, token: "32200310005010", identifier: "310005010" }] });
    expect(transactions.status).toBe(200);
    expect(await transactions.json()).toEqual({ transactions: [{ id: 1, reference: "4617308", processingStatus: "APPLIED", amount: "50.00" }] });
    expect(credits.status).toBe(200);
    expect(await credits.json()).toEqual({ credits: [{ creditoId: 123, currentBalance: "950.00", installmentAmount: "250.00", totalPaid: "50.00" }] });
  });

  test("returns a validation response when Nexa rejects token user creation", async () => {
    const router = createAdminRouter({
      internalApiKey: "dev-secret",
      nexa: {
        createPaymentToken: async () => ({ id: 455, prefix: "32200" }),
        createTokenUsers: async () => ({
          users: [],
          errorUsers: [{ identifier: 100_000_002, reason: "CUI no es válido." }],
        }),
        getPaymentTokenStatement: async () => ({ transactions: [] }),
        reviewTransfer: async (payload: { reference: number; status: "APPROVED" | "REJECTED" }) => ({ reference: payload.reference, status: payload.status }),
      } as never,
      cartera: {} as never,
      paymentTokens: {
        findActive: async () => ({ id: 1, nexaTokenId: 455, prefix: "32200" }),
        create: async () => ({ id: 1 }),
      } as never,
      tokenUsers: {
        nextIdentifierSequence: async () => 100_000_002,
        createTokenUser: async () => ({ id: 1 }),
        findByToken: async () => null,
      } as never,
      transactions: {} as never,
      pollRuns: {} as never,
      accumulatorAccount: 10300102824,
      paymentTokenName: "Club Cashin GTQ UAT",
    });

    const response = await router.request("/token-users", {
      method: "POST",
      headers: {
        Authorization: "Bearer dev-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ creditoId: 123, description: "Credito 123", nationalId: "1234567890123" }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Nexa rejected token user 100000002: CUI no es válido." });
  });
});
