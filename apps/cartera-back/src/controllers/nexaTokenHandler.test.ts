import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import { createNexaTokenHandler } from "./nexaTokenHandler";
import type { NexaTokenDependencies, NexaTokenUpsertResult } from "./nexaTokens";

const url = "http://localhost/internal/nexa/tokens";
const now = 1_800_000_000_000;
const secret = "s".repeat(32);
const body = { creditoId: 123, token: "1234567123456789", identifier: "123456789", nexaUserId: 456 };

const fakeDeps = (over: {
  claimNonce?: boolean;
  creditExists?: boolean;
  upsert?: NexaTokenUpsertResult | "throw";
} = {}) => {
  const calls: string[] = [];
  const deps: NexaTokenDependencies = {
    claimNonce: async () => (calls.push("claimNonce"), over.claimNonce ?? true),
    creditExists: async () => (calls.push("creditExists"), over.creditExists ?? true),
    upsertToken: async () => {
      calls.push("upsertToken");
      if (over.upsert === "throw") throw new Error("x");
      return over.upsert ?? "created";
    },
  };
  return { deps, calls };
};

const sign = (nonce: string, raw: string) => createHmac("sha256", secret).update([
  "POST", new URL(url).pathname, String(now / 1000), nonce,
  createHash("sha256").update(raw).digest("hex"),
].join("\n")).digest("hex");

const request = ({ raw = JSON.stringify(body), nonce = "nonce-1", signature }: {
  raw?: string;
  nonce?: string;
  signature?: string;
} = {}) => new Request(url, {
  method: "POST",
  body: raw,
  headers: {
    "content-type": "application/json",
    "x-nexa-timestamp": String(now / 1000),
    ...(nonce ? { "x-nexa-nonce": nonce } : {}),
    "x-nexa-signature": signature ?? sign(nonce, raw),
  },
});

const cases: {
  name: string;
  deps?: Parameters<typeof fakeDeps>[0];
  req?: () => Request;
  secret?: string;
  status: number;
  body: Record<string, unknown>;
  calls?: string[];
}[] = [
  { name: "created → 201", deps: { upsert: "created" }, status: 201, body: { status: "CREATED", creditoId: 123 } },
  { name: "updated → 200", deps: { upsert: "updated" }, status: 200, body: { status: "UPDATED", creditoId: 123 } },
  { name: "unchanged → 200", deps: { upsert: "unchanged" }, status: 200, body: { status: "UNCHANGED", creditoId: 123 } },
  { name: "token_conflict → 409", deps: { upsert: "token_conflict" }, status: 409, body: { error: "token_conflict" } },
  { name: "nonce repetido → 409", deps: { claimNonce: false }, status: 409, body: { error: "replay" }, calls: ["claimNonce"] },
  { name: "crédito inexistente → 404", deps: { creditExists: false }, status: 404, body: { error: "credit_not_found" } },
  {
    name: "firma incorrecta → 401 sin tocar dependencias",
    req: () => request({ signature: "0".repeat(64) }),
    status: 401, body: { error: "invalid_authentication" }, calls: [],
  },
  {
    name: "sin nonce → 401 sin tocar dependencias",
    req: () => request({ nonce: "" }),
    status: 401, body: { error: "invalid_authentication" }, calls: [],
  },
  {
    name: "token de 9 dígitos → 400",
    req: () => request({ raw: JSON.stringify({ ...body, token: "123456789" }) }),
    status: 400, body: { error: "invalid_body" }, calls: [],
  },
  {
    name: "campo extra → 400",
    req: () => request({ raw: JSON.stringify({ ...body, extra: 1 }) }),
    status: 400, body: { error: "invalid_body" }, calls: [],
  },
  { name: "JSON roto → 400", req: () => request({ raw: "{roto" }), status: 400, body: { error: "invalid_body" }, calls: [] },
  { name: "secreto corto → 503", secret: "s".repeat(10), status: 503, body: { error: "configuration_error" }, calls: [] },
  { name: "falla inesperada → 500", deps: { upsert: "throw" }, status: 500, body: { error: "processing_failed" } },
];

for (const c of cases) {
  test(`handler de tokens: ${c.name}`, async () => {
    const { deps, calls } = fakeDeps(c.deps);
    const handler = createNexaTokenHandler({ secret: c.secret ?? secret, now: () => now, dependencies: deps });
    const set: { status?: number | string } = {};

    const response = await handler({ request: c.req ? c.req() : request(), body: null, set });

    expect(set.status).toBe(c.status);
    expect(response as Record<string, unknown>).toEqual(c.body);
    if (c.calls) expect(calls).toEqual(c.calls);
  });
}
