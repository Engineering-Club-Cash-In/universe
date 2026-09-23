import { expect, test } from "bun:test";
import type { NexaPaymentDependencies } from "../controllers/nexaPayments";

const request = (headers?: HeadersInit) => new Request(
  "http://localhost/internal/nexa/payments/apply",
  { method: "POST", body: "{}", headers },
);

test("no registra la ruta interna de Nexa en production aunque el opt-in esté activo", async () => {
  const module = await import("./nexa").catch(() => ({}));
  const createRouter = Reflect.get(module, "createNexaInternalRouter");

  expect(createRouter).toBeFunction();
  if (typeof createRouter !== "function") return;

  let handlerCalls = 0;
  const router = createRouter("production", true, async () => {
    handlerCalls += 1;
    return { paymentId: 1 };
  });
  const response = await router.handle(request({ "content-type": "application/json" }));

  expect(response.status).toBe(404);
  expect(handlerCalls).toBe(0);
});

test.each(["dev", "development", "qa"])("registra la ruta interna de Nexa en %s con opt-in", async (environment) => {
  const { createNexaInternalRouter } = await import("./nexa");
  const router = createNexaInternalRouter(environment, true, async () => ({ paymentId: 17 }));

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
  });

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
  };
  const handler = createNexaPaymentHandler({
    secret: "s".repeat(32),
    now: () => 1_800_000_000_000,
    dependencies,
  });
  const router = createNexaInternalRouter("development", true, handler);

  const response = await router.handle(request(headers));

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "invalid_authentication" });
  expect(dependencyCalls).toBe(0);
});
