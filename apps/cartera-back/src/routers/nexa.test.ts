import { expect, test } from "bun:test";

test("no registra la ruta interna de Nexa en production aunque el opt-in esté activo", async () => {
  const module = await import("./nexa").catch(() => ({}));
  const createRouter = Reflect.get(module, "createNexaInternalRouter");

  expect(createRouter).toBeFunction();
  if (typeof createRouter !== "function") return;

  const router = createRouter("production", true, async () => ({ paymentId: 1 }));
  const response = await router.handle(
    new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  expect(response.status).toBe(404);
});

test.each(["dev", "development", "qa"])("registra la ruta interna de Nexa en %s con opt-in", async (environment) => {
  const { createNexaInternalRouter } = await import("./nexa");
  const router = createNexaInternalRouter(environment, true, async () => ({ paymentId: 17 }));

  const response = await router.handle(
    new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ paymentId: 17 });
});

test.each(["dev", "development", "qa"])("mantiene la ruta Nexa en 404 en %s sin opt-in", async (environment) => {
  const { createNexaInternalRouter } = await import("./nexa");
  const router = createNexaInternalRouter(environment, false, async () => ({ paymentId: 17 }));

  const response = await router.handle(
    new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  expect(response.status).toBe(404);
});
