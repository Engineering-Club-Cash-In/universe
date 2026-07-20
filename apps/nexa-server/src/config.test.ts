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
  INTERNAL_API_KEY: "production-internal-key",
  CARTERA_API_BASE_URL: "https://cartera.example.com",
  NODE_ENV: "production",
  NEXA_DEPLOYMENT_MODE: "integration",
  MOCK_CARTERA: "true",
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

  it("permite iniciar sin certificados solo en modo mTLS disabled", () => {
    expect(loadConfig({ ...baseEnv, NEXA_MTLS_MODE: "disabled" }).nexaMtlsMode).toBe("disabled");
  });

  it("rechaza mTLS required sin certificado, llave y CA", () => {
    expect(() => loadConfig({ ...baseEnv, NEXA_MTLS_MODE: "required" })).toThrow(
      "NEXA_MTLS_MODE=required requires cert, key and CA paths",
    );
  });

  it("rechaza credenciales de desarrollo en producción", () => {
    expect(() => loadConfig({ ...baseEnv, INTERNAL_API_KEY: "dev-secret" })).toThrow(
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
});
