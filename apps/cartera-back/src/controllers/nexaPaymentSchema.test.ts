import { expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../database/db/schema";

test("define el binding y los eventos idempotentes de Nexa", async () => {
  const binding = Reflect.get(schema, "nexa_credit_bindings");
  const nonces = Reflect.get(schema, "nexa_payment_nonces");
  const events = Reflect.get(schema, "nexa_payment_events");

  expect(binding).toBeDefined();
  expect(nonces).toBeDefined();
  expect(events).toBeDefined();
  if (!binding || !nonces || !events) return;

  const bindingConfig = getTableConfig(binding);
  const nonceConfig = getTableConfig(nonces);
  const eventConfig = getTableConfig(events);
  expect(bindingConfig.columns.map((column) => column.name)).toEqual([
    "credito_id",
    "activo",
    "expires_at",
    "max_payment_amount",
    "created_at",
  ]);
  expect(eventConfig.columns.map((column) => column.name)).toEqual([
    "id",
    "provider",
    "external_reference",
    "nonce",
    "credito_id",
    "amount",
    "currency",
    "payload_hash",
    "status",
    "pago_id",
    "error",
    "created_at",
    "updated_at",
  ]);
  expect(nonceConfig.columns.map((column) => column.name)).toEqual(["nonce", "created_at"]);
  expect(eventConfig.uniqueConstraints).toHaveLength(1);
  expect(eventConfig.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
    "provider",
    "external_reference",
  ]);
  expect(eventConfig.indexes.find((index) => index.config.unique)?.config.columns)
    .toHaveLength(1);

  const migration = Bun.file(
    new URL("../../drizzle/0035_add_nexa_internal_payments.sql", import.meta.url),
  );
  expect(await migration.exists()).toBe(true);
});
