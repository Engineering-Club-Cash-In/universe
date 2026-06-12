import { Hono } from "hono";
import type { AppConfig } from "./config";
import { createDependencies, type AppDependencies } from "./dependencies";
import { createAdminRouter } from "./routes/admin";
import { renderTestConsole } from "./ui/test-console";
import { createPaymentTokenWebhookRouter } from "./webhooks/payment-token";

export function createApp(config: AppConfig, deps: AppDependencies = createDependencies(config)) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/ui", (c) => c.html(renderTestConsole()));
  app.route("/", createPaymentTokenWebhookRouter({
    flowId: config.nexaWebhookFlowId,
    bearerToken: config.nexaWebhookBearerToken,
    nexa: deps.nexa,
    cartera: deps.cartera,
    transactions: deps.transactions,
    tokenUsers: deps.tokenUsers,
  }));
  app.route("/admin", createAdminRouter({
    internalApiKey: config.internalApiKey,
    nexa: deps.nexa,
    cartera: deps.cartera,
    paymentTokens: deps.paymentTokens,
    tokenUsers: deps.tokenUsers,
    transactions: deps.transactions,
    pollRuns: deps.pollRuns,
    mockCredits: deps.mockCredits,
    accumulatorAccount: config.nexaAccumulatorAccount,
    paymentTokenName: config.nexaPaymentTokenName,
  }));

  return app;
}
