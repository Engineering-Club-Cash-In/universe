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
          AND to_regclass('public.nexa_payment_tokens') IS NOT NULL
          AND to_regclass('public.nexa_token_users') IS NOT NULL
          AND to_regclass('public.nexa_reviews') IS NOT NULL
          AND to_regclass('public.mock_cartera_credits') IS NOT NULL
          AND (
            SELECT count(*) = 7
            FROM pg_attribute
            WHERE attrelid = to_regclass('public.nexa_payment_transactions')
              AND attname IN (
                'payload_fingerprint', 'attempt_count', 'next_attempt_at', 'last_attempt_at',
                'lease_until', 'review_attempt_count', 'review_next_attempt_at'
              )
              AND attnum > 0
              AND NOT attisdropped
          )
          AND (
            SELECT count(*) = 3
            FROM pg_attribute
            WHERE attrelid = to_regclass('public.nexa_reviews')
              AND attname IN ('next_attempt_at', 'lease_until', 'completed_at')
              AND attnum > 0
              AND NOT attisdropped
          ) AS ready
      `);
      if (!result.rows[0]?.ready) {
        return c.json({ ok: false, reason: "schema_not_migrated" }, 503);
      }
      const legacy = await deps.db.execute<{ ready: boolean }>(sql`
        SELECT NOT EXISTS (
          SELECT 1 FROM public.nexa_payment_transactions WHERE processing_status = 'PENDING'
        ) AS ready
      `);
      if (!legacy.rows[0]?.ready) {
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
      adminApiKey: config.nexaAdminApiKey!,
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
