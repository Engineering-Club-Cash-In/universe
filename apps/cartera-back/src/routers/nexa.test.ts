import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("no registra la ruta interna de Nexa en production", async () => {
  const module = await import("./nexa").catch(() => ({}));
  const createRouter = Reflect.get(module, "createNexaInternalRouter");

  expect(createRouter).toBeFunction();
  if (typeof createRouter !== "function") return;

  const router = createRouter("production", async () => ({ paymentId: 1 }));
  const response = await router.handle(
    new Request("http://localhost/internal/nexa/payments/apply", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  expect(response.status).toBe(404);
});

test.each(["dev", "development", "qa"])("registra la ruta interna de Nexa en %s", async (environment) => {
  const { createNexaInternalRouter } = await import("./nexa");
  const router = createNexaInternalRouter(environment, async () => ({ paymentId: 17 }));

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

test("el entrypoint monta el router con la configuración declarada", () => {
  const index = readFileSync(join(import.meta.dir, "../index.ts"), "utf8");
  const config = readFileSync(join(import.meta.dir, "../config/index.ts"), "utf8");

  expect(config).toContain("environment:");
  expect(index).toContain("createNexaInternalRouter(config.environment, nexaPaymentHandler)");
});
