import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";

const method = "POST";
const path = "/internal/nexa/payments/apply";
const body = '{"externalReference":"qa-1"}';
const secret = "synthetic-test-secret";
const now = 1_800_000_000_000;
const timestamp = String(Math.floor(now / 1000));
const nonce = "synthetic-nonce-1";
const payload = [
  method,
  path,
  timestamp,
  nonce,
  createHash("sha256").update(body).digest("hex"),
].join("\n");
const signature = createHmac("sha256", secret).update(payload).digest("hex");

test("acepta una firma HMAC válida sobre el body exacto", async () => {
  const hmac = await import("./nexaHmac").catch(() => ({}));
  const verify = Reflect.get(hmac, "verifyNexaHmac");

  expect(verify).toBeFunction();
  if (typeof verify !== "function") return;

  expect(
    verify({
      method,
      path,
      body,
      secret,
      timestamp,
      nonce,
      signature,
      now,
      windowSeconds: 300,
    }),
  ).toEqual({ ok: true });
});

test("rechaza una firma inválida", async () => {
  const { verifyNexaHmac } = await import("./nexaHmac");

  expect(
    verifyNexaHmac({
      method,
      path,
      body,
      secret,
      timestamp,
      nonce,
      signature: "0".repeat(64),
      now,
      windowSeconds: 300,
    }),
  ).toEqual({ ok: false, reason: "invalid_signature" });
});

test("rechaza timestamps fuera de la ventana configurada", async () => {
  const { verifyNexaHmac } = await import("./nexaHmac");

  expect(
    verifyNexaHmac({
      method,
      path,
      body,
      secret,
      timestamp,
      nonce,
      signature,
      now: now + 301_000,
      windowSeconds: 300,
    }),
  ).toEqual({ ok: false, reason: "expired_timestamp" });
});

test("rechaza metadata HMAC que no cabe en persistencia", async () => {
  const { verifyNexaHmac } = await import("./nexaHmac");

  expect(verifyNexaHmac({
    method,
    path,
    body,
    secret,
    timestamp: `${timestamp}.5`,
    nonce,
    signature,
    now,
  })).toEqual({ ok: false, reason: "invalid_headers" });
  expect(verifyNexaHmac({
    method,
    path,
    body,
    secret,
    timestamp,
    nonce: "n".repeat(151),
    signature,
    now,
  })).toEqual({ ok: false, reason: "invalid_headers" });
});

test.each([NaN, Infinity, 0, -1])("rechaza ventana HMAC inválida: %s", async (windowSeconds) => {
  const { verifyNexaHmac } = await import("./nexaHmac");

  expect(verifyNexaHmac({
    method,
    path,
    body,
    secret,
    timestamp,
    nonce,
    signature,
    now,
    windowSeconds,
  })).toEqual({ ok: false, reason: "invalid_headers" });
});
