import { describe, expect, test } from "bun:test";
import { createPaymentTokenWebhookRouter } from "./payment-token";

describe("payment token webhook", () => {
  test("acknowledges Nexa notification and applies payment through cartera", async () => {
    const reviewed: Array<{ id: string; reference: string | number; status: string }> = [];
    const router = createPaymentTokenWebhookRouter({
      flowId: "flow-id",
      bearerToken: "webhook-token",
      nexa: {
        reviewTransfer: async (payload) => {
          reviewed.push(payload);
          return { reference: payload.reference, status: payload.status };
        },
      },
      cartera: {
        applyNexaPayment: async () => ({ status: "APPLIED", paymentId: 123 }),
      },
      transactions: {
        existsByReference: async () => false,
        createPending: async (transaction) => ({ id: 9, ...transaction }),
        markApplied: async () => undefined,
        markRejected: async () => undefined,
        markFailed: async () => undefined,
      },
      tokenUsers: {
        findByToken: async () => ({ creditoId: 42 }),
      },
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
    expect(reviewed).toEqual([{ id: "7293", reference: 4617307, status: "APPROVED" }]);
  });

  test("keeps applied payment status when Nexa review fails after mock cartera applies", async () => {
    let applied = false;
    let failed = false;
    const router = createPaymentTokenWebhookRouter({
      flowId: "flow-id",
      bearerToken: "webhook-token",
      nexa: {
        reviewTransfer: async () => { throw new Error("review failed"); },
      },
      cartera: {
        applyNexaPayment: async () => ({ status: "APPLIED", paymentId: 123 }),
      },
      transactions: {
        existsByReference: async () => false,
        createPending: async (transaction) => ({ id: 9, ...transaction }),
        markApplied: async () => { applied = true; },
        markRejected: async () => undefined,
        markFailed: async () => { failed = true; },
      },
      tokenUsers: {
        findByToken: async () => ({ creditoId: 42 }),
      },
    });

    const response = await router.request("/webhook/v1/payment-token", {
      method: "POST",
      headers: {
        flowId: "flow-id",
        Authorization: "Bearer webhook-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "7293",
        reference: "4617307",
        token: "32200310005010",
        amount: 50,
        originAccount: "19451958",
        originBank: "INDLGTGC",
        comments: "Test transaction",
        currency: "GTQ",
        originAccountName: "Cuenta origen",
      }),
    });

    expect(response.status).toBe(200);
    expect(applied).toBe(true);
    expect(failed).toBe(false);
  });

  test("rejects notifications without configured flowId", async () => {
    const router = createPaymentTokenWebhookRouter({
      flowId: "flow-id",
      bearerToken: "webhook-token",
      nexa: { reviewTransfer: async () => ({ reference: "", status: "REJECTED" }) },
      cartera: { applyNexaPayment: async () => ({ status: "REJECTED", reason: "no" }) },
      transactions: {
        existsByReference: async () => false,
        createPending: async (transaction) => ({ id: 9, ...transaction }),
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
