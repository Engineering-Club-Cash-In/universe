import { describe, expect, test } from "bun:test";
import type { TokenTransaction } from "../nexa/schemas";
import { createPaymentTokenWebhookRouter } from "./payment-token";

describe("payment token webhook", () => {
  test("durably accepts the established date-less payload without inventing a transfer date", async () => {
    const persisted: Array<Omit<TokenTransaction, "tokenDate"> & { tokenDate?: string }> = [];
    const logs: string[] = [];
    const router = createPaymentTokenWebhookRouter({
      flowId: "flow-id",
      bearerToken: "webhook-token",
      nexa: { reviewTransfer: async () => { throw new Error("reviewTransfer must not run during ingestion"); } },
      cartera: { applyNexaPayment: async () => { throw new Error("Cartera must not run during ingestion"); } },
      transactions: {
        upsertReceived: async (value) => {
          persisted.push(value);
          return { id: 9, reference: String(value.reference), processingStatus: "RECEIVED", created: true };
        },
        markApplied: async () => undefined,
        markRejected: async () => undefined,
        markFailed: async () => undefined,
      },
      tokenUsers: { findByToken: async () => { throw new Error("Token lookup must not run during ingestion"); } },
      logInfo: (line) => logs.push(line),
    });

    const response = await router.request("/webhook/v1/payment-token", {
      method: "POST",
      headers: {
        flowId: "flow-id",
        Authorization: "Bearer webhook-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: 7293,
        reference: "4617307",
        token: "1234567310005010",
        amount: 50,
        originAccount: "19451958",
        originBank: "INDLGTGC",
        comments: "Test transaction",
        currency: "GTQ",
        originAccountName: "Cuenta origen",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reference: "4617307", status: "OK" });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      reference: "4617307",
      transactionId: "7293",
      tokenIdentifier: "310005010",
      tokenPrefix: "1234567",
    });
    expect(persisted[0]).not.toHaveProperty("tokenDate");
    expect(JSON.parse(logs[0] ?? "{}")).toMatchObject({ scope: "nexa-webhook", event: "received" });
    expect(logs.join(" ")).not.toContain("webhook-token");
    expect(logs.join(" ")).not.toContain("1234567310005010");
    expect(logs.join(" ")).not.toContain("19451958");
  });

  test("keeps a supported 5-digit token prefix before the 9-digit identifier", async () => {
    const persisted: Array<Omit<TokenTransaction, "tokenDate"> & { tokenDate?: string }> = [];
    const router = createPaymentTokenWebhookRouter({
      flowId: "flow-id",
      bearerToken: "webhook-token",
      nexa: { reviewTransfer: async () => undefined },
      cartera: { applyNexaPayment: async () => ({ status: "REJECTED", reason: "unused" }) },
      transactions: {
        upsertReceived: async (value) => {
          persisted.push(value);
          return { id: 9, reference: String(value.reference), processingStatus: "RECEIVED", created: true };
        },
        markApplied: async () => undefined,
        markRejected: async () => undefined,
        markFailed: async () => undefined,
      },
      tokenUsers: { findByToken: async () => null },
      logInfo: () => undefined,
    });

    const response = await router.request("/webhook/v1/payment-token", {
      method: "POST",
      headers: {
        flowId: "flow-id",
        Authorization: "Bearer webhook-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: 7293,
        reference: 4617307,
        token: "12345100000001",
        amount: 0.29,
        originAccount: "account",
        originBank: "INDLGTGC",
        comments: "",
        currency: "GTQ",
      }),
    });

    expect(response.status).toBe(200);
    expect(persisted[0]).toMatchObject({ tokenIdentifier: "100000001", tokenPrefix: "12345" });
  });

  test("rejects notifications without configured flowId", async () => {
    const router = createPaymentTokenWebhookRouter({
      flowId: "flow-id",
      bearerToken: "webhook-token",
      nexa: { reviewTransfer: async () => undefined },
      cartera: { applyNexaPayment: async () => ({ status: "REJECTED", reason: "unused" }) },
      transactions: {
        upsertReceived: async () => { throw new Error("must not persist unauthorized notifications"); },
        markApplied: async () => undefined,
        markRejected: async () => undefined,
        markFailed: async () => undefined,
      },
      tokenUsers: { findByToken: async () => null },
    });

    const response = await router.request("/webhook/v1/payment-token", {
      method: "POST",
      headers: { flowId: "wrong", Authorization: "Bearer webhook-token", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
  });
});
