import { createHash, createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { TokenTransaction } from "../nexa/schemas";
import { HttpCarteraPaymentClient } from "./cartera-client";

const transaction = (overrides: Partial<TokenTransaction> = {}): TokenTransaction => ({
  reference: 4617308,
  amount: 10,
  bank: "Synthetic Bank",
  comments: "synthetic fixture",
  currency: "GTQ",
  account: "0000000000",
  token: "synthetic-token",
  tokenDate: "2026-09-08T12:00:00Z",
  tokenIdentifier: "synthetic-identifier",
  tokenName: "Synthetic token",
  tokenPrefix: "00000",
  wasReturn: 0,
  transactionId: "tx-123",
  ...overrides,
});

function capturingClient(response: Response = Response.json({ status: "APPLIED", paymentId: 77, idempotent: true, ignored: "strip" })) {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = new HttpCarteraPaymentClient({
    baseUrl: "https://cartera.example.com/",
    secret: "c".repeat(32),
    clock: () => 1_757_332_800_000,
    fetch: async (input, init) => {
      request = { url: String(input), init };
      return response;
    },
  });
  return { client, getRequest: () => request };
}

describe("HttpCarteraPaymentClient", () => {
  test.each([
    [10, "10.00"],
    [10.25, "10.25"],
    [0.29, "0.29"],
  ])("envía el contrato mínimo y firma exactamente el body para %s", async (amount, expectedAmount) => {
    const { client, getRequest } = capturingClient();
    const result = await client.applyNexaPayment({ creditoId: 123, transaction: transaction({ amount }) });
    const request = getRequest();
    const body = request?.init?.body;

    expect(request?.url).toBe("https://cartera.example.com/internal/nexa/payments/apply");
    expect(body).toBe(JSON.stringify({
      externalReference: "4617308",
      creditoId: 123,
      amount: expectedAmount,
      currency: "GTQ",
      transactionId: "tx-123",
    }));
    expect(body).not.toContain("token");
    expect(body).not.toContain("Synthetic Bank");
    expect(request?.init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-nexa-timestamp": "1757332800",
    });

    const headers = request?.init?.headers as Record<string, string>;
    expect(headers["x-nexa-nonce"]).toMatch(/^[0-9a-f-]{36}$/);
    const canonical = [
      "POST",
      "/internal/nexa/payments/apply",
      headers["x-nexa-timestamp"],
      headers["x-nexa-nonce"],
      createHash("sha256").update(String(body)).digest("hex"),
    ].join("\n");
    expect(headers["x-nexa-signature"]).toBe(createHmac("sha256", "c".repeat(32)).update(canonical).digest("hex"));
    expect(result).toEqual({ status: "APPLIED", paymentId: 77, idempotent: true });
  });

  test("omite transactionId vacío", async () => {
    const { client, getRequest } = capturingClient();
    await client.applyNexaPayment({ creditoId: 123, transaction: transaction({ transactionId: "" }) });
    expect(getRequest()?.init?.body).toBe(JSON.stringify({
      externalReference: "4617308",
      creditoId: 123,
      amount: "10.00",
      currency: "GTQ",
    }));
  });

  test("recorta referencias y omite transactionId con solo espacios", async () => {
    const { client, getRequest } = capturingClient();
    await client.applyNexaPayment({
      creditoId: 123,
      transaction: transaction({ reference: "  ref-1  ", transactionId: "   " }),
    });
    expect(getRequest()?.init?.body).toBe(JSON.stringify({
      externalReference: "ref-1",
      creditoId: 123,
      amount: "10.00",
      currency: "GTQ",
    }));
  });

  test("limita externalReference y transactionId antes de enviar", async () => {
    const { client } = capturingClient();
    await expect(client.applyNexaPayment({
      creditoId: 123,
      transaction: transaction({ reference: " ", transactionId: "tx" }),
    })).rejects.toThrow("externalReference");
    await expect(client.applyNexaPayment({
      creditoId: 123,
      transaction: transaction({ reference: "r".repeat(151), transactionId: "tx" }),
    })).rejects.toThrow("externalReference");
    await expect(client.applyNexaPayment({
      creditoId: 123,
      transaction: transaction({ transactionId: ` ${"t".repeat(101)} ` }),
    })).rejects.toThrow("transactionId");
  });

  test("envía transactionId numérico cero", async () => {
    const { client, getRequest } = capturingClient();
    await client.applyNexaPayment({ creditoId: 123, transaction: { ...transaction(), transactionId: 0 } });
    expect(getRequest()?.init?.body).toBe(JSON.stringify({
      externalReference: "4617308",
      creditoId: 123,
      amount: "10.00",
      currency: "GTQ",
      transactionId: "0",
    }));
  });

  test.each([
    [10.001, "GTQ"],
    [0, "GTQ"],
    [-1, "GTQ"],
    [Number.NaN, "GTQ"],
    [90_071_992_547_409.92, "GTQ"],
    [10_000_000_000_000_000, "GTQ"],
    [10, "USD"],
  ] as const)("rechaza monto/currency no aplicable: %s %s", async (amount, currency) => {
    const { client } = capturingClient();
    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction({ amount, currency }) })).rejects.toThrow();
  });

  test("reporta rechazo HTTP sin exponer body ni secreto", async () => {
    const { client } = capturingClient(new Response("sensitive upstream body cartera-secret", { status: 422, statusText: "Unprocessable Entity" }));
    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction() })).resolves.toEqual({
      status: "REJECTED",
      reason: "Cartera payment rejected: HTTP 422 Unprocessable Entity",
    });
  });

  test("solo propaga códigos de error JSON seguros", async () => {
    const body = { error: "binding_expired" };
    const reason = "Cartera payment rejected: HTTP 403 Forbidden (binding_expired)";
    const { client } = capturingClient(Response.json(body, { status: 403, statusText: "Forbidden" }));
    const result = await client.applyNexaPayment({ creditoId: 123, transaction: transaction() });
    expect(result).toEqual({ status: "REJECTED", reason });
    expect(JSON.stringify(result)).not.toContain("cartera-secret");
  });

  test("no convierte un 403 sin código seguro en rechazo terminal", async () => {
    const { client } = capturingClient(Response.json(
      { error: "binding_expired secret=cartera-secret" },
      { status: 403, statusText: "Forbidden" },
    ));
    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction() }))
      .rejects.toThrow("HTTP 403 Forbidden");
  });

  test.each([500, 503, 408, 429, 401])("mantiene HTTP %s como fallo retryable", async (status) => {
    const { client } = capturingClient(new Response("upstream failure", { status }));
    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction() }))
      .rejects.toThrow(`HTTP ${status}`);
  });

  test("mantiene un rechazo de autenticación explícito como retryable", async () => {
    const { client } = capturingClient(Response.json(
      { error: "invalid_authentication" },
      { status: 403, statusText: "Forbidden" },
    ));
    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction() }))
      .rejects.toThrow("HTTP 403 Forbidden");
  });

  test.each([
    new Response("", { status: 204 }),
    new Response("not-json", { status: 200 }),
    Response.json({ status: "APPLIED", paymentId: 0 }),
    Response.json({ status: "APPLIED", paymentId: Number.MAX_SAFE_INTEGER + 1 }),
  ])("rechaza respuesta APPLIED vacía, inválida o malformada", async (response) => {
    const { client } = capturingClient(response);
    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction() })).rejects.toThrow();
  });

  test("aborta la llamada al vencer el timeout", async () => {
    let aborted = false;
    const client = new HttpCarteraPaymentClient({
      baseUrl: "https://cartera.example.com",
      secret: "c".repeat(32),
      timeoutMs: 5,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(init.signal?.reason);
        });
      }),
    });

    await expect(client.applyNexaPayment({ creditoId: 123, transaction: transaction() })).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});
