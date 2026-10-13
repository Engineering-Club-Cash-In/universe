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

test.each(["qa_real_payments", "production"])("%s lifecycle drains application and review work without polling, then stop prevents later cycles", async (mode) => {
  const scheduler = controlledScheduler();
  let polls = 0;
  let applications = 0;
  let reviews = 0;
  const deps = lifecycleDependencies({
    poll: () => { polls++; },
    application: () => ++applications < 3,
    review: () => ++reviews < 2,
  });

  const stop = startPaymentLifecycle(loadConfig({ ...baseEnv, NEXA_DEPLOYMENT_MODE: mode, ...(mode === "production" ? { CARTERA_TARGET_ENV: "production", CARTERA_PRODUCTION_ALLOWED_ORIGINS: baseEnv.CARTERA_API_BASE_URL, NEXA_CARTERA_EVENTS_SECRET: "e".repeat(32) } : {}) }), deps, { scheduler });
  await waitFor(() => applications === 3 && reviews === 2);
  const scheduled = [...scheduler.callbacks];
  stop();
  scheduled.forEach((callback) => callback());
  await Bun.sleep(1);

  expect({ polls, applications, reviews }).toEqual({ polls: 0, applications: 3, reviews: 2 });
});

test.each(["integration"] as const)("%s lifecycle does not start payment loops", async (deploymentMode) => {
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
  await waitFor(() => logs.length === 1 && scheduler.callbacks.length === 5);

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

test("MANUAL_REVIEW uses a restart-safe throttled cadence without delaying actionable alerts", async () => {
  let actionableScans = 0;
  let manualScans = 0;
  const dependencies = () => lifecycleDependencies({
    reconciliation: () => { actionableScans += 1; return []; },
    manualReconciliation: () => { manualScans += 1; return []; },
  });
  const scheduler = controlledScheduler();
  const stop = startPaymentLifecycle(loadConfig(baseEnv), dependencies(), { scheduler });
  await waitFor(() => actionableScans === 1 && scheduler.scheduled.length === 5);

  expect(manualScans).toBe(0);
  expect(scheduler.scheduled.map(({ delay }) => delay).sort((a, b) => a - b)).toEqual([
    1_000,
    1_000,
    1_000,
    30_000,
    300_000,
  ]);
  scheduler.scheduled.filter(({ delay }) => delay === 1_000).forEach(({ callback }) => callback());
  await waitFor(() => actionableScans === 2);
  expect(manualScans).toBe(0);

  scheduler.scheduled.find(({ delay }) => delay === 300_000)?.callback();
  await waitFor(() => manualScans === 1);
  stop();

  const restartedScheduler = controlledScheduler();
  const stopRestarted = startPaymentLifecycle(loadConfig(baseEnv), dependencies(), { scheduler: restartedScheduler });
  await waitFor(() => actionableScans === 3 && restartedScheduler.scheduled.length === 5);
  expect(manualScans).toBe(1);
  restartedScheduler.scheduled.find(({ delay }) => delay === 300_000)?.callback();
  await waitFor(() => manualScans === 2);
  stopRestarted();
});

test("qa lifecycle enriches the date automatically while preserving the bank review route", async () => {
  const scheduler = controlledScheduler();
  const deps = lifecycleDependencies({});
  let enriched = 0;
  deps.transactions.listMissingDateReceipts = async () => [{ reference: "date-test", createdAt: new Date("2026-05-05T01:00:00Z") }];
  deps.transactions.enrichIncomingStatement = async () => { enriched++; return true; };
  deps.nexa.getPaymentTokenStatement = async (date) => ({ transactions: date === "2026-05-04" ? [{
    reference: "date-test", amount: 5, currency: "GTQ", bank: "test", account: "test", comments: "",
    token: "12345100000000", tokenIdentifier: "100000000", tokenPrefix: "12345", tokenName: "test",
    tokenDate: "2026-05-04T00:00:00Z", wasReturn: 0, transactionId: "",
  }] : [] });
  const stop = startPaymentLifecycle(loadConfig(baseEnv), deps, { scheduler });
  try {
    await waitFor(() => enriched === 1);
    expect(scheduler.scheduled.some(({ delay }) => delay === 30_000)).toBe(true);
  } finally { stop(); }
});

const emailEnv = {
  NEXA_ALERTAS_CORREOS: "jalvarado@clubcashin.com,l.ralda@clubcashin.com,daniel.r@clubcashin.com",
  RESEND_API_KEY: "re_test_key",
  EMAIL_DOMAIN: "servicioscashin.com",
};
const unsentCase = {
  id: 5, creditoId: 42, amount: "50.00", currency: "GTQ", reference: "4617307", transactionId: "7293",
  failureReason: "token_mismatch", createdAt: new Date("2026-10-07T16:15:00Z"), maskedToken: "**********5010",
};

test("the manual review scanner emails the new cases once when the email config is present", async () => {
  const scheduler = controlledScheduler();
  const sent: Array<{ to: string[]; subject: string }> = [];
  const marked: number[][] = [];
  const logs: string[] = [];
  const deps = lifecycleDependencies({
    unsentEmail: () => (marked.length ? [] : [unsentCase]),
    markEmail: (ids) => { marked.push(ids); },
  });
  const stop = startPaymentLifecycle(loadConfig({ ...baseEnv, ...emailEnv }), deps, {
    scheduler, logInfo: (line) => logs.push(line), sendEmail: async ({ to, subject }) => { sent.push({ to, subject }); },
  });
  try {
    await waitFor(() => scheduler.scheduled.some(({ delay }) => delay === 300_000));
    for (let pass = 0; pass < 2; pass++) {
      const manual = scheduler.scheduled.filter(({ delay }) => delay === 300_000);
      manual[manual.length - 1]?.callback();
      await waitFor(() => scheduler.scheduled.filter(({ delay }) => delay === 300_000).length === manual.length + 1);
    }
  } finally { stop(); }

  expect(sent).toEqual([{ to: emailEnv.NEXA_ALERTAS_CORREOS.split(","), subject: "Nexa: 1 pago en revisión manual" }]);
  expect(marked).toEqual([[5]]);
  expect(logs.some((line) => line.includes("manual_review_email_disabled"))).toBe(false);
});

test("without NEXA_ALERTAS_CORREOS the scanner only logs, sends nothing and warns once", async () => {
  const scheduler = controlledScheduler();
  const logs: string[] = [];
  let sends = 0;
  let unsentQueries = 0;
  const deps = lifecycleDependencies({ unsentEmail: () => { unsentQueries++; return [unsentCase]; } });
  const stop = startPaymentLifecycle(loadConfig({ ...baseEnv, ...emailEnv, NEXA_ALERTAS_CORREOS: "" }), deps, {
    scheduler, logInfo: (line) => logs.push(line), sendEmail: async () => { sends++; },
  });
  try {
    await waitFor(() => scheduler.scheduled.some(({ delay }) => delay === 300_000));
    scheduler.scheduled.find(({ delay }) => delay === 300_000)?.callback();
    await waitFor(() => scheduler.scheduled.filter(({ delay }) => delay === 300_000).length === 2);
  } finally { stop(); }

  expect({ sends, unsentQueries }).toEqual({ sends: 0, unsentQueries: 0 });
  expect(logs.filter((line) => line.includes("manual_review_email_disabled")).map((line) => JSON.parse(line))).toEqual([
    { scope: "nexa-reconciliation", event: "manual_review_email_disabled", missing: ["NEXA_ALERTAS_CORREOS"] },
  ]);
});

function lifecycleDependencies(options: {
  poll?: () => void;
  application?: () => boolean;
  review?: () => boolean;
  reconciliation?: () => Array<Record<string, unknown>>;
  manualReconciliation?: () => Array<Record<string, unknown>>;
  unsentEmail?: () => Array<typeof unsentCase>;
  markEmail?: (ids: number[]) => void;
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
      listMissingDateReceipts: async () => [],
      enrichIncomingStatement: async () => false,
      listReconciliationAlerts: async () => options.reconciliation?.() ?? [],
      listManualReviewAlerts: async () => options.manualReconciliation?.() ?? [],
      listUnsentManualReviewEmailAlerts: async () => options.unsentEmail?.() ?? [],
      markManualReviewEmailAlertsSent: async (ids: number[]) => options.markEmail?.(ids),
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
  tokenDate: "2026-09-08T12:00:00Z",
  tokenIdentifier: "identifier",
  tokenPrefix: "prefix",
  transactionId: "1",
  wasReturn: 0 as const,
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
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const scheduler: LifecycleScheduler & { callbacks: typeof callbacks; scheduled: typeof scheduled } = {
    callbacks,
    scheduled,
    setTimeout(callback, delay) {
      callbacks.push(callback);
      scheduled.push({ callback, delay });
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
