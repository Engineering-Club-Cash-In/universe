import { expect, test } from "bun:test";
import type { ApplicationClaim, ApplicationWorkerRepository } from "./application-worker";
import { runApplicationWorkerOnce } from "./application-worker";
import { HttpCarteraPaymentClient } from "./cartera-client";

const baseClaim: ApplicationClaim = {
  id: 7,
  reference: "4617307",
  amount: 50,
  currency: "GTQ",
  tokenDate: "2026-05-04T10:00:00-06:00",
  tokenIdentifier: "10005010",
  tokenPrefix: "1234567",
  transactionId: "7293",
  wasReturn: 0,
  attemptCount: 1,
};

test.each([
  [{ currency: "USD" as const }, "unsupported_currency"],
  [{ amount: 0 }, "invalid_amount"],
  [{ amount: -10 }, "invalid_amount"],
  [{ amount: 100_000_000_000_000 }, "invalid_amount"],
  [{ reference: "   " }, "invalid_reference"],
  [{ transactionId: "t".repeat(101) }, "invalid_transaction_id"],
])("terminally rejects unsupported statement transaction %j", async (override, failureReason) => {
  const finalized: unknown[] = [];
  let tokenLookups = 0;
  let carteraCalls = 0;
  let transientFailures = 0;
  const claim = { ...baseClaim, ...override };

  expect(await runApplicationWorkerOnce({
    repository: repository(claim, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => { tokenLookups++; return 42; },
      fail: () => { transientFailures++; },
    }),
    cartera: {
      applyNexaPayment: async () => {
        carteraCalls++;
        return { status: "APPLIED", paymentId: 701 };
      },
    },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  })).toBe(true);

  expect(finalized).toEqual([[
    7,
    { paymentId: null, reviewStatus: "REJECTED", failureReason },
    new Date("2026-09-08T12:00:00Z"),
    1,
  ]]);
  expect({ tokenLookups, carteraCalls, transientFailures }).toEqual({
    tokenLookups: 0,
    carteraCalls: 0,
    transientFailures: 0,
  });
});

test("applied payment keeps billing pending durable while queuing bank approval", async () => {
  const finalized: unknown[] = [];

  await runApplicationWorkerOnce({
    repository: repository(baseClaim, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => 42,
      fail: () => { throw new Error("applied payment must not retry"); },
    }),
    cartera: {
      applyNexaPayment: async () => ({
        status: "APPLIED",
        paymentId: 701,
        billingStatus: "PENDING",
      }),
    },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });

  expect(finalized[0]).toEqual([
    7,
    { paymentId: 701, reviewStatus: "APPROVED", failureReason: "billing_pending", nextAttemptAt: new Date("2026-09-08T12:00:01Z") },
    new Date("2026-09-08T12:00:00Z"),
    1,
  ]);
});

test("applied payment forwards every cartera paymentId to the repository", async () => {
  const finalized: unknown[] = [];
  await runApplicationWorkerOnce({
    repository: repository(baseClaim, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => 42,
      fail: () => { throw new Error("applied payment must not retry"); },
    }),
    cartera: { applyNexaPayment: async () => ({ status: "APPLIED", paymentId: 701, paymentIds: [701, 702] }) },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });

  expect((finalized[0] as unknown[])[1]).toMatchObject({ paymentId: 701, paymentIds: [701, 702] });
});

test("billing retry against an old cartera replica (no paymentIds) does not send a list that would overwrite the stored one", async () => {
  const finalized: unknown[] = [];
  const legacy = new HttpCarteraPaymentClient({
    baseUrl: "https://cartera.example.com",
    secret: "c".repeat(32),
    fetch: async () => Response.json({ status: "APPLIED", paymentId: 701, billingStatus: "PENDING" }),
  });
  await runApplicationWorkerOnce({
    repository: repository({ ...baseClaim, carteraPaymentId: 701 }, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => 42,
      fail: () => { throw new Error("billing retry must not fail"); },
    }),
    cartera: legacy,
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });

  const outcome = (finalized[0] as unknown[])[1] as { paymentId: number; paymentIds?: number[] };
  expect(outcome.paymentId).toBe(701);
  expect(outcome.paymentIds).toBeUndefined();
});

test.each(["rejected", "different_payment", "missing_token"])("billing retry %s cannot reject or replace applied money", async (scenario) => {
  const finalized: unknown[] = [];
  let failures = 0;
  let calls = 0;
  await runApplicationWorkerOnce({
    repository: repository({ ...baseClaim, carteraPaymentId: 701 }, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => scenario === "missing_token" ? null : 42,
      fail: () => { failures++; },
    }),
    cartera: { applyNexaPayment: async () => {
      calls++;
      return scenario === "rejected"
        ? { status: "REJECTED", reason: "binding_missing" }
        : { status: "APPLIED", paymentId: 702 };
    } },
    leaseSeconds: 10, maxAttempts: 3, backoffSeconds: 1, maxBackoffSeconds: 10,
  });
  expect(finalized).toEqual([]);
  expect(failures).toBe(1);
  expect(calls).toBe(scenario === "missing_token" ? 0 : 1);
});

test("malformed persisted date fails closed before unsupported classification", async () => {
  const finalized: unknown[] = [];
  let tokenLookups = 0;
  let carteraCalls = 0;
  let transientFailures = 0;
  const claim: ApplicationClaim = {
    ...baseClaim,
    currency: "USD",
    tokenDate: "not-a-date",
  };

  await runApplicationWorkerOnce({
    repository: repository(claim, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => { tokenLookups++; return 42; },
      fail: () => { transientFailures++; },
    }),
    cartera: {
      applyNexaPayment: async () => {
        carteraCalls++;
        return { status: "APPLIED", paymentId: 701 };
      },
    },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });

  expect(finalized).toEqual([]);
  expect({ tokenLookups, carteraCalls, transientFailures }).toEqual({
    tokenLookups: 0,
    carteraCalls: 0,
    transientFailures: 1,
  });
});

test("returned transfer rejection keeps precedence over unsupported values", async () => {
  const finalized: unknown[] = [];
  const claim: ApplicationClaim = {
    ...baseClaim,
    amount: -10,
    currency: "USD",
    wasReturn: 1,
  };

  await runApplicationWorkerOnce({
    repository: repository(claim, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => { throw new Error("returned transfer must not resolve a token"); },
      fail: () => { throw new Error("returned transfer must not become transient"); },
    }),
    cartera: { applyNexaPayment: async () => { throw new Error("returned transfer must not call Cartera"); } },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });

  expect(finalized[0]).toEqual([
    7,
    { paymentId: null, reviewStatus: "REJECTED", failureReason: "returned_transfer" },
    new Date("2026-09-08T12:00:00Z"),
    1,
  ]);
});

test("manda a cartera el token completo: prefijo + identificador", async () => {
  const finalized: unknown[] = [];
  const receivedTransaction: unknown[] = [];
  const claim: ApplicationClaim = {
    ...baseClaim,
    tokenPrefix: "32200",
    tokenIdentifier: "100000002",
  };

  await runApplicationWorkerOnce({
    repository: repository(claim, {
      finalize: (...args) => { finalized.push(args); },
      lookup: () => 42,
      fail: () => { throw new Error("token passing must not fail"); },
    }),
    cartera: {
      applyNexaPayment: async (input) => {
        receivedTransaction.push(input.transaction);
        return { status: "APPLIED", paymentId: 701 };
      },
    },
    now: () => new Date("2026-09-08T12:00:00Z"),
    leaseSeconds: 10,
    maxAttempts: 3,
    backoffSeconds: 1,
    maxBackoffSeconds: 10,
  });

  expect(receivedTransaction[0]).toMatchObject({
    token: "32200100000002",
  });
  expect(finalized[0]).toEqual([
    7,
    { paymentId: 701, reviewStatus: "APPROVED", failureReason: null, nextAttemptAt: null },
    new Date("2026-09-08T12:00:00Z"),
    1,
  ]);
});

function repository(claim: ApplicationClaim, callbacks: {
  finalize: (...args: Parameters<ApplicationWorkerRepository["finalizeApplication"]>) => void;
  lookup: () => number | null;
  fail: () => void;
}): ApplicationWorkerRepository {
  let claimed = false;
  return {
    claimNextApplication: async () => claimed ? null : (claimed = true, claim),
    resolveCreditoId: async () => callbacks.lookup(),
    finalizeApplication: async (...args) => callbacks.finalize(...args),
    markApplicationFailed: async () => callbacks.fail(),
  };
}
