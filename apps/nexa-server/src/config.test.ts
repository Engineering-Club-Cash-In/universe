import { describe, expect, it } from "bun:test";
import { loadConfig } from "./config";

const baseEnv = {
  PORT: "7010",
  DATABASE_URL: "postgres://user:pass@localhost:5432/nexa",
  NEXA_BASE_URL: "https://open-bank.example.com",
  NEXA_API_KEY: "api-key",
  NEXA_BEARER_TOKEN: "bearer-token",
  NEXA_ACCUMULATOR_ACCOUNT: "123456",
  NEXA_PAYMENT_TOKEN_NAME: "Cashin",
  NEXA_WEBHOOK_FLOW_ID: "production-flow",
  NEXA_WEBHOOK_BEARER_TOKEN: "production-webhook-token",
  NEXA_ADMIN_API_KEY: "a".repeat(32),
  CARTERA_INTERNAL_API_SECRET: "c".repeat(32),
  CARTERA_API_BASE_URL: "https://cartera.example.com",
  NODE_ENV: "production",
  NEXA_DEPLOYMENT_MODE: "integration",
  MOCK_CARTERA: "true",
};

const qaRealEnv = {
  ...baseEnv,
  NEXA_DEPLOYMENT_MODE: "qa_real_payments",
  MOCK_CARTERA: "false",
  NEXA_MTLS_MODE: "required",
  NEXA_CLIENT_CERT_PATH: "/certs/client.crt",
  NEXA_CLIENT_KEY_PATH: "/certs/client.key",
  NEXA_CA_CERT_PATH: "/certs/ca.crt",
  CARTERA_TARGET_ENV: "qa",
  CARTERA_QA_ALLOWED_ORIGINS: "https://cartera.example.com",
  ENABLE_TEST_UI: "false",
};

describe("loadConfig", () => {
  it("interpreta explícitamente MOCK_CARTERA=false como false", () => {
    expect(
      loadConfig({
        ...baseEnv,
        NEXA_DEPLOYMENT_MODE: "production",
        MOCK_CARTERA: "false",
        NEXA_MTLS_MODE: "required",
        NEXA_CLIENT_CERT_PATH: "/certs/client.crt",
        NEXA_CLIENT_KEY_PATH: "/certs/client.key",
        NEXA_CA_CERT_PATH: "/certs/ca.crt",
      }).mockCartera,
    ).toBe(false);
    expect(loadConfig({ ...baseEnv, MOCK_CARTERA: "true" }).mockCartera).toBe(true);
  });

  it("mantiene UI y API administrativa apagadas por defecto", () => {
    const config = loadConfig(baseEnv);
    expect(config.enableTestUi).toBe(false);
    expect(config.enableAdminApi).toBe(false);
  });

  it("no exige secretos ni URL de Cartera cuando usa mock sin API administrativa", () => {
    const { NEXA_ADMIN_API_KEY, CARTERA_INTERNAL_API_SECRET, CARTERA_API_BASE_URL, ...env } = baseEnv;
    const config = loadConfig(env);

    expect(config.nexaAdminApiKey).toBeUndefined();
    expect(config.carteraInternalApiSecret).toBeUndefined();
    expect(config.carteraApiBaseUrl).toBeUndefined();
  });

  it("permite iniciar sin certificados solo en modo mTLS disabled", () => {
    expect(loadConfig({ ...baseEnv, NEXA_MTLS_MODE: "disabled" }).nexaMtlsMode).toBe("disabled");
  });

  it("rechaza mTLS required sin certificado, llave y CA", () => {
    expect(() => loadConfig({ ...baseEnv, NEXA_MTLS_MODE: "required" })).toThrow(
      "NEXA_MTLS_MODE=required requires cert, key and CA paths",
    );
  });

  it("rechaza credenciales de desarrollo en producción", () => {
    expect(() => loadConfig({ ...baseEnv, NEXA_ADMIN_API_KEY: "dev-secret" })).toThrow(
      "uses a forbidden development credential",
    );
  });

  it("impide convertir el candidato con mock y sin mTLS en producción", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NEXA_DEPLOYMENT_MODE: "production",
        MOCK_CARTERA: "true",
        NEXA_MTLS_MODE: "disabled",
      }),
    ).toThrow("Production deployment cannot use mock cartera");
  });

  it("impide que integration use la Cartera HTTP real", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NEXA_DEPLOYMENT_MODE: "integration",
        MOCK_CARTERA: "false",
      }),
    ).toThrow("Integration deployment requires mock cartera");
  });

  it("acepta qa_real_payments cerrado con target development o qa", () => {
    expect(loadConfig(qaRealEnv).deploymentMode).toBe("qa_real_payments");
    expect(loadConfig({
      ...qaRealEnv,
      CARTERA_TARGET_ENV: "development",
      CARTERA_API_BASE_URL: "http://127.0.0.1:7000",
      CARTERA_DEVELOPMENT_ALLOWED_ORIGINS: "http://127.0.0.1:7000",
    }).carteraTargetEnv).toBe("development");
  });

  it.each([
    ["mock cartera", { MOCK_CARTERA: "true" }],
    ["mTLS disabled", { NEXA_MTLS_MODE: "disabled", NEXA_CLIENT_CERT_PATH: undefined, NEXA_CLIENT_KEY_PATH: undefined, NEXA_CA_CERT_PATH: undefined }],
    ["target production", { CARTERA_TARGET_ENV: "production" }],
    ["test UI", { ENABLE_TEST_UI: "true" }],
    ["cartera secret missing", { CARTERA_INTERNAL_API_SECRET: undefined }],
    ["shared credentials", { CARTERA_INTERNAL_API_SECRET: "a".repeat(32) }],
    ["short cartera secret", { CARTERA_INTERNAL_API_SECRET: "short" }],
    ["HTTP qa", { CARTERA_API_BASE_URL: "http://cartera.example.com" }],
    ["origin fuera de allowlist", { CARTERA_QA_ALLOWED_ORIGINS: "https://other.example.com" }],
    ["allowlist faltante", { CARTERA_QA_ALLOWED_ORIGINS: undefined }],
  ])("rechaza qa_real_payments con %s", (_case, overrides) => {
    expect(() => loadConfig({ ...qaRealEnv, ...overrides })).toThrow();
  });

  it("exige secretos separados y fuertes siempre que Cartera sea real", () => {
    expect(() => loadConfig({
      ...baseEnv,
      NEXA_DEPLOYMENT_MODE: "production",
      MOCK_CARTERA: "false",
      NEXA_MTLS_MODE: "required",
      NEXA_CLIENT_CERT_PATH: "/certs/client.crt",
      NEXA_CLIENT_KEY_PATH: "/certs/client.key",
      NEXA_CA_CERT_PATH: "/certs/ca.crt",
      CARTERA_INTERNAL_API_SECRET: "a".repeat(32),
    })).toThrow("separate credentials");
  });

  it("configura un timeout finito positivo para Cartera", () => {
    expect(loadConfig({ ...qaRealEnv, CARTERA_API_TIMEOUT_MS: "2500" }).carteraApiTimeoutMs).toBe(2500);
    expect(() => loadConfig({ ...qaRealEnv, CARTERA_API_TIMEOUT_MS: "0" })).toThrow();
  });

  it("configura límites positivos y finitos para el worker de aplicación", () => {
    const defaults = loadConfig(baseEnv);
    expect({
      lease: defaults.workerLeaseSeconds,
      attempts: defaults.workerMaxAttempts,
      backoff: defaults.workerBackoffSeconds,
      maxBackoff: defaults.workerMaxBackoffSeconds,
    }).toEqual({ lease: 60, attempts: 5, backoff: 5, maxBackoff: 300 });

    for (const [name, value] of [
      ["WORKER_LEASE_SECONDS", "0"],
      ["WORKER_MAX_ATTEMPTS", "-1"],
      ["WORKER_BACKOFF_SECONDS", "Infinity"],
      ["WORKER_MAX_BACKOFF_SECONDS", "NaN"],
    ]) {
      expect(() => loadConfig({ ...baseEnv, [name]: value })).toThrow();
    }
  });

  it("configura un intervalo positivo compartido por los workers", () => {
    expect(loadConfig(baseEnv).workerIntervalSeconds).toBe(1);
    expect(loadConfig({ ...baseEnv, WORKER_INTERVAL_SECONDS: "3" }).workerIntervalSeconds).toBe(3);
    expect(() => loadConfig({ ...baseEnv, WORKER_INTERVAL_SECONDS: "0" })).toThrow();
  });
});
