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
    // Cuenta Nexa del cliente (migración 0045).
    "nexa_user_id",
    "nexa_identifier",
    "nexa_token",
    "nexa_national_id",
    "cuenta_solicitada_at",
    "cuenta_intentos",
    "cuenta_error",
    "cuenta_notificada_at",
    "updated_at",
    // Migración 0048.
    "token_registrado_at",
  ]);
  const tokenIndex = bindingConfig.indexes.find((index) => index.config.name === "nexa_credit_bindings_uq_token");
  expect(tokenIndex?.config.unique).toBe(true);
  expect(tokenIndex?.config.columns.map((column) => "name" in column ? column.name : "")).toEqual(["nexa_token"]);
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
    "pago_id_eliminado",
    "error",
    "created_at",
    "updated_at",
    // Bandeja del recibo por WhatsApp (migraciones 0046 y 0047).
    "recibo_status",
    "recibo_intentos",
    "recibo_actualizado_at",
    "recibo_pagos_ok",
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
    new URL("../../drizzle/0039_add_nexa_internal_payments.sql", import.meta.url),
  );
  expect(await migration.exists()).toBe(true);
  const tokenMigration = Bun.file(
    new URL("../../drizzle/0048_nexa_token_binding.sql", import.meta.url),
  );
  expect(await tokenMigration.exists()).toBe(true);  const outboxMigration = Bun.file(
    new URL("../../drizzle/0049_nexa_outbox.sql", import.meta.url),
  );
  expect(await outboxMigration.exists()).toBe(true);
  const pagoEliminadoMigration = Bun.file(
    new URL("../../drizzle/0050_nexa_evento_pago_eliminado.sql", import.meta.url),
  );
  expect(await pagoEliminadoMigration.text()).toContain("ADD COLUMN IF NOT EXISTS pago_id_eliminado integer");
});

test("define la cola nexa_outbox con evento único e índice de pendientes", () => {
  const outbox = Reflect.get(schema, "nexa_outbox");
  expect(outbox).toBeDefined();
  if (!outbox) return;
  const config = getTableConfig(outbox);
  expect(config.columns.map((column) => column.name)).toEqual([
    "id",
    "event_id",
    "tipo",
    "credito_id",
    "payload",
    "intentos",
    "ultimo_error",
    "proximo_intento_at",
    "enviado_at",
    "created_at",
  ]);
  expect(config.columns.find((column) => column.name === "event_id")?.isUnique).toBe(true);
  expect(config.indexes.map((index) => index.config.name)).toEqual(["idx_nexa_outbox_pendientes"]);
});
