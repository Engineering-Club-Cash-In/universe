import { describe, expect, test } from "bun:test";
import { createApp } from "../app";

describe("test console UI", () => {
  test("serves a local endpoint testing page", async () => {
    const app = createApp({
      port: 7010,
      databaseUrl: "postgres://example",
      nexaBaseUrl: "https://nexa.example",
      nexaApiKey: "api-key",
      nexaBearerToken: "bearer-token",
      nexaMtlsMode: "disabled",
      nexaAccumulatorAccount: 10300102824,
      nexaPaymentTokenName: "Club Cashin GTQ UAT",
      nexaWebhookFlowId: "local-flow",
      nexaWebhookBearerToken: "local-webhook-token",
      nexaPollIntervalSeconds: 300,
      nexaPollLookbackDays: 1,
      internalApiKey: "dev-secret",
      carteraApiBaseUrl: "http://localhost:7000",
      mockCartera: true,
      enableAdminApi: true,
      enableTestUi: true,
      nodeEnv: "test",
      deploymentMode: "integration",
    }, {} as never);

    const response = await app.request("/ui");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Nexa UAT Test Console");
    expect(html).toContain("/admin/tokens/bootstrap");
    expect(html).toContain("/webhook/v1/payment-token");
    expect(html).toContain('id="internalApiKey" type="password" value=""');
    expect(html).toContain("Cargar tokens");
    expect(html).toContain("Estado de cuenta local");
    expect(html).toContain("Cartera mock");
    expect(html).toContain("Saldo actual");
    expect(html).toContain("selectedToken");
    expect(html).toContain("replace(/\\/$/, '')");
    expect(html).toContain("'\\n' + response.status");
  });
});
