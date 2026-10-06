import { describe, expect, test } from "bun:test";
import { syncTokensToCartera } from "./sync-cartera";

describe("syncTokensToCartera", () => {
  test("syncs active tokens and skips inactive ones", async () => {
    const callLog: Array<{ creditoId: number }> = [];
    const tokenUsers = {
      list: async () => [
        { creditoId: 1, token: "token1", identifier: "id1", nexaUserId: 1, active: true },
        { creditoId: 2, token: "token2", identifier: "id2", nexaUserId: 2, active: true },
        { creditoId: 3, token: "token3", identifier: "id3", nexaUserId: 3, active: true },
        { creditoId: 4, token: "token4", identifier: "id4", nexaUserId: 4, active: true },
        { creditoId: 5, token: "token5", identifier: "id5", nexaUserId: 5, active: true },
        { creditoId: 6, token: "token6", identifier: "id6", nexaUserId: 6, active: false },
      ],
    };
    const cartera = {
      registerNexaToken: async (params: { creditoId: number }) => {
        callLog.push({ creditoId: params.creditoId });
        if (params.creditoId === 1) return { status: "CREATED" as const };
        if (params.creditoId === 2) return { status: "UPDATED" as const };
        if (params.creditoId === 3) return { status: "UNCHANGED" as const };
        if (params.creditoId === 4) return { status: "REJECTED" as const, reason: "token_conflict" };
        if (params.creditoId === 5) throw new Error("Network error");
        throw new Error("Unexpected creditoId");
      },
    };

    const summary = await syncTokensToCartera({ tokenUsers, cartera, cancelledTokenUsers: { deactivateByCreditoId: async () => 0 } });

    expect(summary).toEqual({
      total: 5,
      created: 1,
      updated: 1,
      unchanged: 1,
      skippedInactive: 1,
      rejected: [{ creditoId: 4, reason: "token_conflict" }],
      failed: [{ creditoId: 5 }],
    });
    expect(callLog.map(c => c.creditoId)).toEqual([1, 2, 3, 4, 5]);
  });

  test("salta un usuario activo cuyo token de pago padre está inactivo", async () => {
    const llamados: number[] = [];
    const summary = await syncTokensToCartera({
      tokenUsers: { list: async () => [
        { creditoId: 1, token: "t1", identifier: "id1", nexaUserId: 1, active: true, paymentTokenActive: false },
        { creditoId: 2, token: "t2", identifier: "id2", nexaUserId: 2, active: true, paymentTokenActive: true },
      ] },
      cartera: { registerNexaToken: async (p: { creditoId: number }) => { llamados.push(p.creditoId); return { status: "CREATED" as const }; } },
      cancelledTokenUsers: { deactivateByCreditoId: async () => 0 },
    });
    expect(llamados).toEqual([2]);
    expect(summary.skippedInactive).toBe(1);
    expect(summary.total).toBe(1);
  });

  test("returns zero counts for empty list", async () => {
    const tokenUsers = {
      list: async () => [],
    };
    const cartera = {
      registerNexaToken: async () => ({ status: "CREATED" as const }),
    };

    const summary = await syncTokensToCartera({ tokenUsers, cartera, cancelledTokenUsers: { deactivateByCreditoId: async () => 0 } });

    expect(summary).toEqual({
      total: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedInactive: 0,
      rejected: [],
      failed: [],
    });
  });

  test("registra prefijo + identificador cuando el token de Nexa difiere", async () => {
    const sent: string[] = [];
    await syncTokensToCartera({
      tokenUsers: { list: async () => [{ creditoId: 1, token: "OTRO", identifier: "100000002", nexaUserId: 1, active: true, prefix: "32200" }] },
      cartera: { registerNexaToken: async (p: { token: string }) => { sent.push(p.token); return { status: "CREATED" as const }; } },
      cancelledTokenUsers: { deactivateByCreditoId: async () => 0 },
    });
    expect(sent).toEqual(["32200100000002"]);
  });

  test("credit_cancelled desactiva el token user local; otros rechazos no", async () => {
    const users = [
      { creditoId: 1, token: "t1", identifier: "id1", nexaUserId: 1, active: true },
      { creditoId: 2, token: "t2", identifier: "id2", nexaUserId: 2, active: true },
    ];
    const summary = await syncTokensToCartera({
      tokenUsers: { list: async () => users },
      cartera: {
        registerNexaToken: async (p: { creditoId: number }) => ({
          status: "REJECTED" as const,
          reason: p.creditoId === 1 ? "credit_cancelled" : "token_conflict",
        }),
      },
      cancelledTokenUsers: {
        deactivateByCreditoId: async (creditoId: number) => {
          users.filter((u) => u.creditoId === creditoId).forEach((u) => (u.active = false));
          return 1;
        },
      },
    });
    expect(users.map((u) => u.active)).toEqual([false, true]);
    // El resumen no cambia: sigue reportando el rechazo.
    expect(summary.rejected).toEqual([{ creditoId: 1, reason: "credit_cancelled" }, { creditoId: 2, reason: "token_conflict" }]);
    expect(summary.failed).toEqual([]);
  });

  test("si desactivar falla, el resumen queda igual", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const summary = await syncTokensToCartera({
        tokenUsers: { list: async () => [{ creditoId: 1, token: "t1", identifier: "id1", nexaUserId: 1, active: true }] },
        cartera: { registerNexaToken: async () => ({ status: "REJECTED" as const, reason: "credit_cancelled" }) },
        cancelledTokenUsers: { deactivateByCreditoId: async () => { throw new Error("db down"); } },
      });
      expect(summary.rejected).toEqual([{ creditoId: 1, reason: "credit_cancelled" }]);
      expect(summary.failed).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});
