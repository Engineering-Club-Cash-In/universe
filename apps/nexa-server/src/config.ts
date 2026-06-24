import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(7010),
  databaseUrl: z.string().min(1),
  nexaBaseUrl: z.string().url(),
  nexaApiKey: z.string().min(1),
  nexaBearerToken: z.string().min(1),
  nexaClientCertPath: z.string().min(1).optional(),
  nexaClientKeyPath: z.string().min(1).optional(),
  nexaCaCertPath: z.string().min(1).optional(),
  nexaAccumulatorAccount: z.coerce.number(),
  nexaPaymentTokenName: z.string().min(1),
  nexaWebhookFlowId: z.string().min(1),
  nexaWebhookBearerToken: z.string().min(1),
  nexaPollIntervalSeconds: z.coerce.number().int().positive().default(30),
  nexaPollLookbackDays: z.coerce.number().int().min(0).default(1),
  internalApiKey: z.string().min(1),
  carteraApiBaseUrl: z.string().url(),
  mockCartera: z.coerce.boolean().default(false),
});

export function loadConfig(env = process.env) {
  return configSchema.parse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    nexaBaseUrl: env.NEXA_BASE_URL,
    nexaApiKey: env.NEXA_API_KEY,
    nexaBearerToken: env.NEXA_BEARER_TOKEN,
    nexaClientCertPath: env.NEXA_CLIENT_CERT_PATH,
    nexaClientKeyPath: env.NEXA_CLIENT_KEY_PATH,
    nexaCaCertPath: env.NEXA_CA_CERT_PATH,
    nexaAccumulatorAccount: env.NEXA_ACCUMULATOR_ACCOUNT,
    nexaPaymentTokenName: env.NEXA_PAYMENT_TOKEN_NAME,
    nexaWebhookFlowId: env.NEXA_WEBHOOK_FLOW_ID,
    nexaWebhookBearerToken: env.NEXA_WEBHOOK_BEARER_TOKEN,
    nexaPollIntervalSeconds: env.NEXA_POLL_INTERVAL_SECONDS,
    nexaPollLookbackDays: env.NEXA_POLL_LOOKBACK_DAYS,
    internalApiKey: env.INTERNAL_API_KEY,
    carteraApiBaseUrl: env.CARTERA_API_BASE_URL,
    mockCartera: env.MOCK_CARTERA,
  });
}

export type AppConfig = ReturnType<typeof loadConfig>;
