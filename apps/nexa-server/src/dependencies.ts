import type { AppConfig } from "./config";
import { createDb } from "./db";
import { DbPaymentTransactionRepository, DbReviewRepository, DbTokenUserRepository, MockCreditRepository, PaymentTokenRepository, PollRunRepository } from "./db/repositories";
import { NexaClient } from "./nexa/client";
import { HttpCarteraPaymentClient } from "./payments/cartera-client";
import { MockCarteraPaymentClient } from "./payments/mock-cartera-client";

export function createDependencies(config: AppConfig) {
  const db = createDb(config.databaseUrl);
  const nexa = new NexaClient({
    baseUrl: config.nexaBaseUrl,
    apiKey: config.nexaApiKey,
    bearerToken: config.nexaBearerToken,
    tls: config.nexaMtlsMode === "required"
      ? {
        certPath: config.nexaClientCertPath!,
        keyPath: config.nexaClientKeyPath!,
        caPath: config.nexaCaCertPath,
      }
      : undefined,
  });
  const mockCredits = new MockCreditRepository(db);
  const cartera = config.mockCartera
    ? new MockCarteraPaymentClient(mockCredits)
    : new HttpCarteraPaymentClient({
      baseUrl: config.carteraApiBaseUrl!,
      secret: config.carteraInternalApiSecret!,
      timeoutMs: config.carteraApiTimeoutMs,
    });

  return {
    db,
    nexa,
    cartera,
    paymentTokens: new PaymentTokenRepository(db),
    tokenUsers: new DbTokenUserRepository(db),
    transactions: new DbPaymentTransactionRepository(db),
    reviews: new DbReviewRepository(db),
    pollRuns: new PollRunRepository(db),
    mockCredits,
  };
}

export type AppDependencies = ReturnType<typeof createDependencies>;
