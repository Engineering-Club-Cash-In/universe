import { describe, expect, test } from "bun:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createApp } from "../app";
import { CARTERA_EVENTS_PATH, NonceReplayCache, createCarteraEventsRouter } from "./cartera-events";

const SECRET = "s".repeat(48);
const NOW_MS = 1_790_000_000_000;

function sign(body: string, options: { secret?: string; timestamp?: number; nonce?: string; path?: string } = {}) {
  const timestamp = String(options.timestamp ?? Math.floor(NOW_MS / 1000));
  const nonce = options.nonce ?? randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", options.secret ?? SECRET)
    .update(["POST", options.path ?? CARTERA_EVENTS_PATH, timestamp, nonce, bodyHash].join("\n"))
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "x-cartera-timestamp": timestamp,
    "x-cartera-nonce": nonce,
    "x-cartera-signature": signature,
  };
}

function fakeTokenUsers(initial: Record<number, number> = { 9234: 1 }) {
  const active = new Map(Object.entries(initial).map(([k, v]) => [Number(k), v]));
  const calls: number[] = [];
  return {
    calls,
    deactivateByCreditoId: async (creditoId: number) => {
      calls.push(creditoId);
      const count = active.get(creditoId) ?? 0;
      active.set(creditoId, 0);
      return count;
    },
  };
}

function setup(overrides: { secret?: string; tokenUsers?: ReturnType<typeof fakeTokenUsers> } = {}) {
  const logs: string[] = [];
  const tokenUsers = overrides.tokenUsers ?? fakeTokenUsers();
  const router = createCarteraEventsRouter({
    secret: "secret" in overrides ? overrides.secret : SECRET,
    tokenUsers,
    now: () => NOW_MS,
    logInfo: (line) => logs.push(line),
  });
  return { router, tokenUsers, logs };
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    eventId: "7f0c2f5e-3d1a-4c55-9a43-2f8f2f0f9b11",
    type: "credit_cancelled",
    creditoId: 9234,
    occurredAt: "2026-10-05T15:00:00.000Z",
    ...overrides,
  });
}

function post(router: ReturnType<typeof setup>["router"], body: string, headers: Record<string, string>) {
  return router.request(CARTERA_EVENTS_PATH, { method: "POST", headers, body });
}

describe("POST /internal/cartera/events", () => {
  test("valid signature deactivates the credit's token users", async () => {
    const { router, tokenUsers, logs } = setup();
    const body = eventBody();
    const headers = sign(body);
    const response = await post(router, body, headers);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      eventId: "7f0c2f5e-3d1a-4c55-9a43-2f8f2f0f9b11",
      deactivated: 1,
    });
    expect(tokenUsers.calls).toEqual([9234]);
    const applied = logs.map((line) => JSON.parse(line)).find((entry) => entry.event === "credit-cancelled-applied");
    expect(applied).toMatchObject({ scope: "cartera-events", creditoId: 9234, deactivated: 1 });
    const joined = logs.join(" ");
    expect(joined).not.toContain(SECRET);
    expect(joined).not.toContain(headers["x-cartera-signature"]);
  });

  test("repeating the same event (new nonce) is 200 with deactivated 0", async () => {
    const { router, tokenUsers } = setup();
    const body = eventBody();
    expect((await post(router, body, sign(body))).status).toBe(200);
    const second = await post(router, body, sign(body));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "ok", deactivated: 0 });
    expect(tokenUsers.calls).toEqual([9234, 9234]);
  });

  test("a replayed nonce inside the window is rejected", async () => {
    const { router, tokenUsers } = setup();
    const body = eventBody();
    const headers = sign(body);
    expect((await post(router, body, headers)).status).toBe(200);
    const replay = await post(router, body, headers);
    expect(replay.status).toBe(401);
    expect(tokenUsers.calls).toEqual([9234]);
  });

  test.each([
    ["wrong secret", (body: string) => sign(body, { secret: "x".repeat(48) })],
    ["different signed path", (body: string) => sign(body, { path: "/internal/nexa/tokens" })],
    ["timestamp 301s old", (body: string) => sign(body, { timestamp: Math.floor(NOW_MS / 1000) - 301 })],
    ["timestamp 301s in the future", (body: string) => sign(body, { timestamp: Math.floor(NOW_MS / 1000) + 301 })],
    ["non-uuid nonce", (body: string) => sign(body, { nonce: "not-a-uuid" })],
    ["missing signature", (body: string) => {
      const { "x-cartera-signature": _ignored, ...rest } = sign(body);
      return rest;
    }],
    ["uppercase signature", (body: string) => {
      const headers = sign(body);
      return { ...headers, "x-cartera-signature": headers["x-cartera-signature"].toUpperCase() };
    }],
  ])("%s -> 401 and nothing changes", async (_case, makeHeaders) => {
    const { router, tokenUsers } = setup();
    const body = eventBody();
    const response = await post(router, body, makeHeaders(body) as Record<string, string>);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_authentication" });
    expect(tokenUsers.calls).toEqual([]);
  });

  test("body tampered after signing -> 401", async () => {
    const { router, tokenUsers } = setup();
    const headers = sign(eventBody());
    const response = await post(router, eventBody({ creditoId: 1 }), headers);
    expect(response.status).toBe(401);
    expect(tokenUsers.calls).toEqual([]);
  });

  test("timestamp exactly at the window edge is accepted", async () => {
    const { router } = setup();
    const body = eventBody();
    const response = await post(router, body, sign(body, { timestamp: Math.floor(NOW_MS / 1000) - 300 }));
    expect(response.status).toBe(200);
  });

  test.each([
    ["malformed JSON", "{not json"],
    ["unknown type", eventBody({ type: "credit_reactivated" })],
    ["extra field", eventBody({ extra: true })],
    ["non-positive creditoId", eventBody({ creditoId: 0 })],
    ["string creditoId", eventBody({ creditoId: "9234" })],
    ["fractional creditoId", eventBody({ creditoId: 9234.5 })],
    ["non-uuid eventId", eventBody({ eventId: "abc" })],
    ["non-ISO occurredAt", eventBody({ occurredAt: "yesterday" })],
    ["array body", "[]"],
  ])("signed but %s -> 400", async (_case, body) => {
    const { router, tokenUsers } = setup();
    const response = await post(router, body, sign(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    expect(tokenUsers.calls).toEqual([]);
  });

  test("oversized body -> 400 without touching the repository", async () => {
    const { router, tokenUsers } = setup();
    const body = eventBody({ occurredAt: "2026-10-05T15:00:00.000Z", padding: "x".repeat(10_000) });
    const response = await post(router, body, sign(body));
    expect(response.status).toBe(400);
    expect(tokenUsers.calls).toEqual([]);
  });

  test("repository failure -> 500 so cartera retries", async () => {
    const logs: string[] = [];
    const router = createCarteraEventsRouter({
      secret: SECRET,
      tokenUsers: { deactivateByCreditoId: async () => { throw new Error("db down"); } },
      now: () => NOW_MS,
      logInfo: (line) => logs.push(line),
    });
    const body = eventBody();
    const response = await post(router, body, sign(body));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "processing_failed" });
    expect(logs.join(" ")).not.toContain("db down");
  });

  test.each([
    ["undefined", undefined],
    ["empty", ""],
    ["shorter than 32 bytes", "short-secret"],
  ])("secret %s -> 503 before reading the body", async (_case, secret) => {
    const { router, tokenUsers } = setup({ secret });
    const body = eventBody();
    const response = await post(router, body, sign(body, { secret: secret || "anything" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "configuration_error" });
    expect(tokenUsers.calls).toEqual([]);
  });

  test("app mounts the route and answers 503 when NEXA_CARTERA_EVENTS_SECRET is absent", async () => {
    const app = createApp({ nexaCarteraEventsSecret: undefined } as never, {} as never);
    const body = eventBody();
    const response = await app.request(CARTERA_EVENTS_PATH, { method: "POST", headers: sign(body), body });
    expect(response.status).toBe(503);
  });
});

describe("NonceReplayCache", () => {
  test("forgets a nonce once its window has passed", () => {
    const cache = new NonceReplayCache();
    expect(cache.claim("a", 1_000, 0)).toBe(true);
    expect(cache.claim("a", 1_000, 999)).toBe(false);
    expect(cache.claim("a", 5_000, 1_001)).toBe(true);
  });

  test("is bounded: evicts the oldest entry when full", () => {
    const cache = new NonceReplayCache(2);
    expect(cache.claim("a", 10_000, 0)).toBe(true);
    expect(cache.claim("b", 10_000, 0)).toBe(true);
    expect(cache.claim("c", 10_000, 0)).toBe(true);
    expect(cache.claim("a", 10_000, 0)).toBe(true);
    expect(cache.claim("c", 10_000, 0)).toBe(false);
  });
});
