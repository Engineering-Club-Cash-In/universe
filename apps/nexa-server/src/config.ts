import { z } from "zod";

const envBoolean = z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) =>
  typeof value === "boolean" ? value : value === "true",
);
const envOrigins = z.string().transform((value) =>
  value.split(",").map((origin) => origin.trim()).filter(Boolean),
).optional();
const positiveFiniteInteger = z.coerce.number().int().finite().positive();

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
  workerLeaseSeconds: positiveFiniteInteger.default(60),
  workerIntervalSeconds: positiveFiniteInteger.default(1),
  workerMaxAttempts: positiveFiniteInteger.default(5),
  workerBackoffSeconds: positiveFiniteInteger.default(5),
  workerMaxBackoffSeconds: positiveFiniteInteger.default(300),
  nexaAdminApiKey: z.string().trim().min(1).optional(),
  carteraInternalApiSecret: z.string().trim().min(1).optional(),
  carteraApiBaseUrl: z.string().url().optional(),
  carteraApiTimeoutMs: z.coerce.number().int().positive().default(10_000),
  carteraTargetEnv: z.enum(["development", "qa"]).optional(),
  carteraDevelopmentAllowedOrigins: envOrigins,
  carteraQaAllowedOrigins: envOrigins,
  mockCartera: envBoolean.default(false),
  enableAdminApi: envBoolean.default(false),
  enableTestUi: envBoolean.default(false),
  nodeEnv: z.string().default("development"),
  deploymentMode: z.enum(["integration", "qa_real_payments", "production"]).default("integration"),
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
      ["nexaAdminApiKey", config.nexaAdminApiKey],
      ["carteraInternalApiSecret", config.carteraInternalApiSecret],
      ["nexaWebhookFlowId", config.nexaWebhookFlowId],
      ["nexaWebhookBearerToken", config.nexaWebhookBearerToken],
    ] as const) {
      if (value && forbidden.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} uses a forbidden development credential`,
        });
      }
    }
  }
  if (config.enableAdminApi && !config.nexaAdminApiKey) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nexaAdminApiKey"], message: "Admin API requires NEXA_ADMIN_API_KEY" });
  }
  if (!config.mockCartera) {
    if (!config.carteraApiBaseUrl) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["carteraApiBaseUrl"], message: "Real cartera requires CARTERA_API_BASE_URL" });
    }
    if (!config.carteraInternalApiSecret || config.carteraInternalApiSecret.length < 32 || Buffer.byteLength(config.carteraInternalApiSecret) < 32) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["carteraInternalApiSecret"], message: "Real cartera requires CARTERA_INTERNAL_API_SECRET with at least 32 characters and bytes" });
    }
    if (config.nexaAdminApiKey && config.nexaAdminApiKey === config.carteraInternalApiSecret) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["carteraInternalApiSecret"], message: "Real cartera requires separate credentials" });
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
  if (config.deploymentMode === "qa_real_payments") {
    if (config.mockCartera) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["mockCartera"], message: "qa_real_payments cannot use mock cartera" });
    }
    if (config.nexaMtlsMode !== "required") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nexaMtlsMode"], message: "qa_real_payments requires mTLS" });
    }
    if (!config.carteraTargetEnv) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["carteraTargetEnv"], message: "qa_real_payments requires CARTERA_TARGET_ENV development or qa" });
    }
    if (config.enableTestUi) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["enableTestUi"], message: "qa_real_payments cannot expose the test UI" });
    }
    if (config.carteraApiBaseUrl && config.carteraTargetEnv) {
      const url = new URL(config.carteraApiBaseUrl);
      const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      if (url.protocol !== "https:" && !(config.carteraTargetEnv === "development" && loopback)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["carteraApiBaseUrl"], message: "qa_real_payments requires HTTPS except development loopback" });
      }
      const origins = config.carteraTargetEnv === "development"
        ? config.carteraDevelopmentAllowedOrigins
        : config.carteraQaAllowedOrigins;
      if (!origins?.length || !origins.includes(url.origin)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["carteraApiBaseUrl"], message: "Cartera origin is not allowed for CARTERA_TARGET_ENV" });
      }
    }
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
    workerLeaseSeconds: env.WORKER_LEASE_SECONDS,
    workerIntervalSeconds: env.WORKER_INTERVAL_SECONDS,
    workerMaxAttempts: env.WORKER_MAX_ATTEMPTS,
    workerBackoffSeconds: env.WORKER_BACKOFF_SECONDS,
    workerMaxBackoffSeconds: env.WORKER_MAX_BACKOFF_SECONDS,
    nexaAdminApiKey: env.NEXA_ADMIN_API_KEY,
    carteraInternalApiSecret: env.CARTERA_INTERNAL_API_SECRET,
    carteraApiBaseUrl: env.CARTERA_API_BASE_URL,
    carteraApiTimeoutMs: env.CARTERA_API_TIMEOUT_MS,
    carteraTargetEnv: env.CARTERA_TARGET_ENV,
    carteraDevelopmentAllowedOrigins: env.CARTERA_DEVELOPMENT_ALLOWED_ORIGINS,
    carteraQaAllowedOrigins: env.CARTERA_QA_ALLOWED_ORIGINS,
    mockCartera: env.MOCK_CARTERA,
    enableAdminApi: env.ENABLE_ADMIN_API,
    enableTestUi: env.ENABLE_TEST_UI,
    nodeEnv: env.NODE_ENV,
    deploymentMode: env.NEXA_DEPLOYMENT_MODE,
  });
}

export type AppConfig = ReturnType<typeof loadConfig>;
