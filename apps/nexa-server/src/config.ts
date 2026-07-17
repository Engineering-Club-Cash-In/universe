import { z } from "zod";

const envBoolean = z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) =>
  typeof value === "boolean" ? value : value === "true",
);

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(7010),
  databaseUrl: z.string().min(1),
  nexaBaseUrl: z.string().url(),
  nexaApiKey: z.string().min(1),
  nexaBearerToken: z.string().min(1),
  nexaClientCertPath: z.string().min(1).optional(),
  nexaClientKeyPath: z.string().min(1).optional(),
  nexaCaCertPath: z.string().min(1).optional(),
  nexaMtlsMode: z.enum(["disabled", "required"]).default("disabled"),
  nexaAccumulatorAccount: z.coerce.number(),
  nexaPaymentTokenName: z.string().min(1),
  nexaWebhookFlowId: z.string().min(1),
  nexaWebhookBearerToken: z.string().min(1),
  nexaPollIntervalSeconds: z.coerce.number().int().positive().default(30),
  nexaPollLookbackDays: z.coerce.number().int().min(0).default(1),
  internalApiKey: z.string().min(1),
  carteraApiBaseUrl: z.string().url(),
  mockCartera: envBoolean.default(false),
  enableAdminApi: envBoolean.default(false),
  enableTestUi: envBoolean.default(false),
  nodeEnv: z.string().default("development"),
  deploymentMode: z.enum(["integration", "production"]).default("integration"),
}).superRefine((config, context) => {
  const tlsPaths = [config.nexaClientCertPath, config.nexaClientKeyPath, config.nexaCaCertPath];
  if (config.nexaMtlsMode === "required" && tlsPaths.some((value) => !value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nexaMtlsMode"],
      message: "NEXA_MTLS_MODE=required requires cert, key and CA paths",
    });
  }
  if (config.nexaMtlsMode === "disabled" && tlsPaths.some(Boolean)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nexaMtlsMode"],
      message: "TLS paths must be absent when NEXA_MTLS_MODE=disabled",
    });
  }
  if (config.nodeEnv === "production") {
    const forbidden = new Set(["dev-secret", "local-flow", "local-webhook-token"]);
    for (const [path, value] of [
      ["internalApiKey", config.internalApiKey],
      ["nexaWebhookFlowId", config.nexaWebhookFlowId],
      ["nexaWebhookBearerToken", config.nexaWebhookBearerToken],
    ] as const) {
      if (forbidden.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} uses a forbidden development credential`,
        });
      }
    }
  }
  if (config.deploymentMode === "production") {
    if (config.mockCartera) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mockCartera"],
        message: "Production deployment cannot use mock cartera",
      });
    }
    if (config.enableTestUi) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enableTestUi"],
        message: "Production deployment cannot expose the test UI",
      });
    }
    if (config.nexaMtlsMode !== "required") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nexaMtlsMode"],
        message: "Production deployment requires mTLS",
      });
    }
  }
  if (config.deploymentMode === "integration" && !config.mockCartera) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mockCartera"],
      message: "Integration deployment requires mock cartera",
    });
  }
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
    nexaMtlsMode: env.NEXA_MTLS_MODE,
    nexaAccumulatorAccount: env.NEXA_ACCUMULATOR_ACCOUNT,
    nexaPaymentTokenName: env.NEXA_PAYMENT_TOKEN_NAME,
    nexaWebhookFlowId: env.NEXA_WEBHOOK_FLOW_ID,
    nexaWebhookBearerToken: env.NEXA_WEBHOOK_BEARER_TOKEN,
    nexaPollIntervalSeconds: env.NEXA_POLL_INTERVAL_SECONDS,
    nexaPollLookbackDays: env.NEXA_POLL_LOOKBACK_DAYS,
    internalApiKey: env.INTERNAL_API_KEY,
    carteraApiBaseUrl: env.CARTERA_API_BASE_URL,
    mockCartera: env.MOCK_CARTERA,
    enableAdminApi: env.ENABLE_ADMIN_API,
    enableTestUi: env.ENABLE_TEST_UI,
    nodeEnv: env.NODE_ENV,
    deploymentMode: env.NEXA_DEPLOYMENT_MODE,
  });
}

export type AppConfig = ReturnType<typeof loadConfig>;
