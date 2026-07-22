import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import type { AppConfig } from "./config";
import { createDependencies, type AppDependencies } from "./dependencies";
import { createAdminRouter } from "./routes/admin";
import { renderTestConsole } from "./ui/test-console";
import { appVersion } from "./version";
import { createPaymentTokenWebhookRouter } from "./webhooks/payment-token";

export function createApp(config: AppConfig, deps: AppDependencies = createDependencies(config)) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, version: appVersion }));
  const readinessHandler = async (c: Context) => {
    try {
      const result = await deps.db.execute<{ ready: boolean }>(sql`
        SELECT
          to_regclass('public.nexa_payment_transactions') IS NOT NULL
          AND to_regclass('public.mock_cartera_credits') IS NOT NULL AS ready
      `);
      if (!result.rows[0]?.ready) {
        return c.json({ ok: false, reason: "schema_not_migrated" }, 503);
      }
      return c.json({ ok: true, version: appVersion });
    } catch {
      return c.json({ ok: false, reason: "database_unavailable" }, 503);
    }
  };
  app.get("/ready", readinessHandler);
  app.get("/healthcheck", readinessHandler);
  if (config.enableTestUi) {
    app.get("/ui", (c) => c.html(renderTestConsole()));
  }
  app.route("/", createPaymentTokenWebhookRouter({
    flowId: config.nexaWebhookFlowId,
    bearerToken: config.nexaWebhookBearerToken,
    nexa: deps.nexa,
    cartera: deps.cartera,
    transactions: deps.transactions,
    tokenUsers: deps.tokenUsers,
  }));
  if (config.enableAdminApi) {
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
  }

  return app;
}
