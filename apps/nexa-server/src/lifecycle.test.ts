import { expect, test } from "bun:test";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";
import type { AppDependencies } from "./dependencies";
import { startPaymentLifecycle, type LifecycleScheduler } from "./lifecycle";

const baseEnv = {
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
  CARTERA_TARGET_ENV: "qa",
  CARTERA_QA_ALLOWED_ORIGINS: "https://cartera.example.com",
  NEXA_DEPLOYMENT_MODE: "qa_real_payments",
  MOCK_CARTERA: "false",
  NEXA_MTLS_MODE: "required",
  NEXA_CLIENT_CERT_PATH: "/certs/client.crt",
  NEXA_CLIENT_KEY_PATH: "/certs/client.key",
  NEXA_CA_CERT_PATH: "/certs/ca.crt",
};

test("qa lifecycle drains application and review work without polling, then stop prevents later cycles", async () => {
  const scheduler = controlledScheduler();
  let polls = 0;
  let applications = 0;
  let reviews = 0;
  const deps = lifecycleDependencies({
    poll: () => { polls++; },
    application: () => ++applications < 3,
    review: () => ++reviews < 2,
  });

  const stop = startPaymentLifecycle(loadConfig(baseEnv), deps, { scheduler });
  await waitFor(() => applications === 3 && reviews === 2);
  const scheduled = [...scheduler.callbacks];
  stop();
  scheduled.forEach((callback) => callback());
  await Bun.sleep(1);

  expect({ polls, applications, reviews }).toEqual({ polls: 0, applications: 3, reviews: 2 });
});

test.each(["integration", "production"] as const)("%s lifecycle does not start payment loops", async (deploymentMode) => {
  let calls = 0;
  const config = { ...loadConfig(baseEnv), deploymentMode } as AppConfig;
  const stop = startPaymentLifecycle(config, lifecycleDependencies({
    poll: () => { calls++; },
    application: () => { calls++; return false; },
    review: () => { calls++; return false; },
  }), { scheduler: controlledScheduler() });
  await Bun.sleep(5);
  stop();
  expect(calls).toBe(0);
});


test("a failed cycle is logged without its error detail and the next cycle runs", async () => {
  const scheduler = controlledScheduler();
  const logs: string[] = [];
  let applications = 0;
  const stop = startPaymentLifecycle(loadConfig(baseEnv), lifecycleDependencies({
    application: () => {
      applications++;
      if (applications === 1) throw new Error("secret token 123");
      return false;
    },
  }), { scheduler, logError: (message) => logs.push(message) });
  await waitFor(() => logs.length === 1 && scheduler.callbacks.length === 3);

  scheduler.callbacks.forEach((callback) => callback());
  await waitFor(() => applications === 2);
  stop();

  expect(applications).toBe(2);
  expect(logs).toEqual(["Application worker cycle failed"]);
});

test("qa lifecycle scans reconciliation alerts at the worker interval and logs only safe fields", async () => {
  const scheduler = controlledScheduler();
  const logs: string[] = [];
  let scans = 0;
  const deps = lifecycleDependencies({
    reconciliation: () => {
      scans++;
      return [{
        alertType: "FAILED_DUE",
        reference: "safe-reference",
        processingStatus: "FAILED",
        attemptCount: 2,
        reviewAttemptCount: 0,
        failureReason: "payment_amount_mismatch",
        updatedAt: new Date("2026-09-08T11:00:00.000Z"),
        nextAttemptAt: new Date("2026-09-08T12:00:00.000Z"),
        reviewNextAttemptAt: null,
      }];
    },
  });

  const stop = startPaymentLifecycle(loadConfig(baseEnv), deps, { scheduler, logInfo: (line) => logs.push(line) });
  await waitFor(() => scans === 1 && logs.length >= 1);
  stop();

  const alert = logs.map((line) => JSON.parse(line)).find((line) => line.event === "reconciliation_alert");
  expect(alert).toEqual({
    scope: "nexa-reconciliation",
    event: "reconciliation_alert",
    alertType: "FAILED_DUE",
    reference: "safe-reference",
    processingStatus: "FAILED",
    attemptCount: 2,
    reviewAttemptCount: 0,
    failureReason: "payment_amount_mismatch",
    updatedAt: "2026-09-08T11:00:00.000Z",
    nextAttemptAt: "2026-09-08T12:00:00.000Z",
    reviewNextAttemptAt: null,
  });
  expect(logs.join(" ")).not.toContain("token");
});

function lifecycleDependencies(options: {
  poll?: () => void;
  application?: () => boolean;
  review?: () => boolean;
  reconciliation?: () => Array<Record<string, unknown>>;
}): AppDependencies {
  return {
    nexa: {
      getPaymentTokenStatement: async () => {
        options.poll?.();
        return { transactions: [] };
      },
      reviewTransfer: async () => undefined,
    },
    cartera: { applyNexaPayment: async () => ({ status: "REJECTED" as const }) },
    transactions: {
      claimNextApplication: async () => options.application?.() ? applicationClaim : null,
      resolveCreditoId: async () => null,
      finalizeApplication: async () => undefined,
      markApplicationFailed: async () => undefined,
      upsertReceived: async () => ({ id: 1, reference: "1", processingStatus: "RECEIVED" as const, created: true }),
      listReconciliationAlerts: async () => options.reconciliation?.() ?? [],
    },
    reviews: {
      claimNextReview: async () => options.review?.() ? reviewClaim : null,
      completeReview: async () => undefined,
      failReview: async () => undefined,
    },
    tokenUsers: {},
    pollRuns: {
      run: async (_date: string, callback: () => Promise<unknown>) => callback(),
    },
  } as unknown as AppDependencies;
}

const applicationClaim = {
  id: 1,
  reference: "1",
  amount: 1,
  currency: "GTQ" as const,
  tokenIdentifier: "identifier",
  tokenPrefix: "prefix",
  transactionId: "1",
  attemptCount: 1,
};

const reviewClaim = {
  id: 1,
  paymentTransactionId: 1,
  nexaTransactionId: "1",
  reference: "1",
  status: "APPROVED" as const,
  attemptCount: 1,
};

function controlledScheduler() {
  const callbacks: Array<() => void> = [];
  const scheduler: LifecycleScheduler & { callbacks: typeof callbacks } = {
    callbacks,
    setTimeout(callback) {
      callbacks.push(callback);
      return callback;
    },
    clearTimeout() {},
  };
  return scheduler;
}

async function waitFor(predicate: () => boolean) {
  for (let index = 0; index < 100 && !predicate(); index++) await Bun.sleep(1);
  if (!predicate()) throw new Error("condition was not reached");
}
