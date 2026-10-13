import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import type { NexaPaymentDependencies } from "../controllers/nexaPayments";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";

const url = "http://localhost/internal/nexa/payments/apply";
const tokenUrl = "http://localhost/internal/nexa/tokens";
const now = 1_800_000_000_000;
const secret = "s".repeat(32);
const paymentLock = {} as PaymentAdvisoryLock;
const body = {
  externalReference: "production-payment-1",
  creditoId: 10,
  amount: "10.00",
  currency: "GTQ" as const,
  tokenDate: "2026-09-08T12:00:00Z",
  token: "1111222233334444",
};
const tokenBody = {
  creditoId: 123,
  token: "1234567890123456",
  identifier: "123456789",
  nexaUserId: 456,
};
const request = (headers?: HeadersInit) => new Request(
  url,
  { method: "POST", body: "{}", headers },
);
const signedRequest = (nonce: string) => {
  const rawBody = JSON.stringify(body);
  const timestamp = String(now / 1000);
  const signature = createHmac("sha256", secret).update([
    "POST",
    new URL(url).pathname,
    timestamp,
    nonce,
    createHash("sha256").update(rawBody).digest("hex"),
  ].join("\n")).digest("hex");
  return new Request(url, {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-nexa-timestamp": timestamp,
      "x-nexa-nonce": nonce,
      "x-nexa-signature": signature,
    },
  });
};
const signedTokenRequest = (nonce: string) => {
  const rawBody = JSON.stringify(tokenBody);
  const timestamp = String(now / 1000);
  const signature = createHmac("sha256", secret).update([
    "POST",
    new URL(tokenUrl).pathname,
    timestamp,
    nonce,
    createHash("sha256").update(rawBody).digest("hex"),
  ].join("\n")).digest("hex");
  return new Request(tokenUrl, {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-nexa-timestamp": timestamp,
      "x-nexa-nonce": nonce,
      "x-nexa-signature": signature,
    },
  });
};

test("mantiene la ruta de producción en 404 sin opt-in y no toca el handler", async () => {
  const { createNexaInternalRouter } = await import("./nexa");
  let handlerCalls = 0;
  const router = createNexaInternalRouter("production", false, async () => {
    handlerCalls += 1;
    return { paymentId: 1 };
  }, async () => ({}));

  const response = await router.handle(request({ "content-type": "application/json" }));

  expect(response.status).toBe(404);
  expect(handlerCalls).toBe(0);
});

test("registra la ruta de producción con opt-in", async () => {
  const { createNexaInternalRouter } = await import("./nexa");
  const router = createNexaInternalRouter("production", true, async () => ({ paymentId: 17 }), async () => ({}));

  const response = await router.handle(request({ "content-type": "application/json" }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ paymentId: 17 });
});

test.each(["", "prod", "staging", "unknown"])(
  "rechaza el ambiente desconocido %p aun con opt-in",
  async (environment) => {
    const { createNexaInternalRouter } = await import("./nexa");
    let handlerCalls = 0;
    const router = createNexaInternalRouter(environment, true, async () => {
      handlerCalls += 1;
      return { paymentId: 17 };
    }, async () => ({}));

    const response = await router.handle(request({ "content-type": "application/json" }));

    expect(response.status).toBe(404);
    expect(handlerCalls).toBe(0);
  },
);

test.each(["dev", "development", "qa"])("registra la ruta interna de Nexa en %s con opt-in", async (environment) => {
  const { createNexaInternalRouter } = await import("./nexa");
  const router = createNexaInternalRouter(environment, true, async () => ({ paymentId: 17 }), async () => ({}));

  const response = await router.handle(request({ "content-type": "application/json" }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ paymentId: 17 });
});

test.each(["dev", "development", "qa"])("mantiene la ruta Nexa en 404 en %s sin opt-in", async (environment) => {
  const { createNexaInternalRouter } = await import("./nexa");
  let handlerCalls = 0;
  const router = createNexaInternalRouter(environment, false, async () => {
    handlerCalls += 1;
    return { paymentId: 17 };
  }, async () => ({}));

  const response = await router.handle(request({ "content-type": "application/json" }));

  expect(response.status).toBe(404);
  expect(handlerCalls).toBe(0);
});

test.each([
  ["sin HMAC", {}],
  ["con HMAC inválido", {
    "x-nexa-timestamp": "1800000000",
    "x-nexa-nonce": "nonce-router-invalid",
    "x-nexa-signature": "0".repeat(64),
  }],
])("rechaza %s antes de tocar dependencias de pago", async (_case, headers) => {
  const { createNexaPaymentHandler } = await import("../controllers/nexaPayments");
  const { createNexaInternalRouter } = await import("./nexa");
  let dependencyCalls = 0;
  const touchedDependency = async (): Promise<never> => {
    dependencyCalls += 1;
    throw new Error("payment dependency called before authentication");
  };
  const dependencies: NexaPaymentDependencies = {
    withCreditLock: touchedDependency,
    claim: touchedDependency,
    loadCredit: touchedDependency,
    findPayments: touchedDependency,
    registerPayment: touchedDependency,
    applyPayment: touchedDependency,
    complete: touchedDependency,
    fail: touchedDependency,
    billPayments: touchedDependency,
    completeBilling: touchedDependency,
    failBilling: touchedDependency,
  };
  const handler = createNexaPaymentHandler({
    secret: "s".repeat(32),
    now: () => 1_800_000_000_000,
    dependencies,
  });
  const router = createNexaInternalRouter("production", true, handler, async () => ({}));

  const response = await router.handle(request(headers));

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "invalid_authentication" });
  expect(dependencyCalls).toBe(0);
});

test("una solicitud firmada usa el handler real y la idempotencia en producción", async () => {
  const { createNexaPaymentHandler } = await import("../controllers/nexaPayments");
  const { createNexaInternalRouter } = await import("./nexa");
  let eventStatus = "missing";
  let registered = 0;
  let applied = 0;
  const dependencies: NexaPaymentDependencies = {
    withCreditLock: async (_creditoId, work) => work(paymentLock),
    claim: async () => eventStatus === "applied"
      ? { kind: "applied", paymentId: 17 }
      : (eventStatus = "processing", { kind: "new", eventId: 7 }),
    loadCredit: async () => ({
      usuarioId: 5,
      statusCredit: "ACTIVO",
      binding: { activo: true, expires_at: null, max_payment_amount: null, nexa_token: "1111222233334444" },
    }),
    findPayments: async () => registered
      ? [{ paymentId: 17, validationStatus: applied ? "validated" : "pending", amount: "10.00" }]
      : [],
    registerPayment: async (_body, _eventId, _usuarioId, validateAfterLock) => {
      await validateAfterLock();
      registered += 1;
      return { success: true };
    },
    applyPayment: async () => { applied += 1; return { success: true }; },
    complete: async () => undefined,
    fail: async () => { eventStatus = "failed"; },
    billPayments: async () => ({ kind: "billed" }),
    completeBilling: async () => { eventStatus = "applied"; },
    failBilling: async () => { eventStatus = "failed"; },
  };
  const handler = createNexaPaymentHandler({ secret, now: () => now, dependencies });
  const router = createNexaInternalRouter("production", true, handler, async () => ({}));

  const first = await router.handle(signedRequest("nonce-production-1"));
  const duplicate = await router.handle(signedRequest("nonce-production-2"));

  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ status: "APPLIED", paymentId: 17, paymentIds: [17], idempotent: false });
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toEqual({ status: "APPLIED", paymentId: 17, paymentIds: [17], idempotent: true });
  expect({ registered, applied }).toEqual({ registered: 1, applied: 1 });
});

test("rechaza un crédito sin binding a través de la ruta de producción", async () => {
  const { createNexaPaymentHandler } = await import("../controllers/nexaPayments");
  const { createNexaInternalRouter } = await import("./nexa");
  let paymentMutations = 0;
  const dependencies: NexaPaymentDependencies = {
    withCreditLock: async (_creditoId, work) => work(paymentLock),
    claim: async () => ({ kind: "new", eventId: 7 }),
    loadCredit: async () => ({ usuarioId: 5, statusCredit: "ACTIVO", binding: null }),
    findPayments: async () => [],
    registerPayment: async () => { paymentMutations += 1; return { success: true }; },
    applyPayment: async () => { paymentMutations += 1; return { success: true }; },
    complete: async () => { paymentMutations += 1; },
    fail: async () => undefined,
    billPayments: async () => { paymentMutations += 1; return { kind: "billed" }; },
    completeBilling: async () => { paymentMutations += 1; },
    failBilling: async () => undefined,
  };
  const handler = createNexaPaymentHandler({ secret, now: () => now, dependencies });
  const router = createNexaInternalRouter("production", true, handler, async () => ({}));

  const response = await router.handle(signedRequest("nonce-unbound-credit"));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "binding_missing" });
  expect(paymentMutations).toBe(0);
});

test("enruta POST /internal/nexa/tokens al handler de tokens con opt-in", async () => {
  const { createNexaInternalRouter } = await import("./nexa");
  let tokenHandlerCalls = 0;
  let paymentHandlerCalls = 0;
  const router = createNexaInternalRouter(
    "production",
    true,
    async () => {
      paymentHandlerCalls += 1;
      return { paymentId: 1 };
    },
    async () => {
      tokenHandlerCalls += 1;
      return { status: "CREATED", creditoId: 123 };
    },
  );

  const response = await router.handle(signedTokenRequest("nonce-token-1"));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "CREATED", creditoId: 123 });
  expect(tokenHandlerCalls).toBe(1);
  expect(paymentHandlerCalls).toBe(0);
});

test("ruta de tokens no existe sin opt-in", async () => {
  const { createNexaInternalRouter } = await import("./nexa");
  let tokenHandlerCalls = 0;
  const router = createNexaInternalRouter(
    "production",
    false,
    async () => ({}),
    async () => {
      tokenHandlerCalls += 1;
      return {};
    },
  );

  const response = await router.handle(signedTokenRequest("nonce-token-disabled"));

  expect(response.status).toBe(404);
  expect(tokenHandlerCalls).toBe(0);
});
