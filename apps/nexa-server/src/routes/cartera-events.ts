import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

/**
 * Inbound events from cartera (cartera -> nexa-server).
 *
 * Cartera signs each request with HMAC-SHA256 over the same canonical string
 * nexa-server uses towards cartera:
 *   ["POST", "/internal/cartera/events", timestamp, nonce, sha256hex(body)].join("\n")
 * The path is the fixed contract path, not the request URL, so a proxy that
 * rewrites the prefix cannot change what is signed.
 */
export const CARTERA_EVENTS_PATH = "/internal/cartera/events";
const SIGNATURE_WINDOW_SECONDS = 300;
const MAX_BODY_BYTES = 4 * 1024;
const MIN_SECRET_BYTES = 32;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const carteraEventSchema = z.object({
  eventId: z.string().regex(UUID_PATTERN),
  type: z.literal("credit_cancelled"),
  creditoId: z.number().int().positive().max(2_147_483_647),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export interface CarteraEventTokenUsers {
  /** Deactivates the active token users of a credit; returns how many changed. */
  deactivateByCreditoId(creditoId: number): Promise<number>;
}

type VerifyResult = { ok: true; expiresAtMs: number } | { ok: false; reason: "invalid_headers" | "expired_timestamp" | "invalid_signature" };

export function verifyCarteraSignature(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  signature: string;
  body: string;
  nowMs: number;
  windowSeconds?: number;
}): VerifyResult {
  const windowMs = (input.windowSeconds ?? SIGNATURE_WINDOW_SECONDS) * 1000;
  if (!/^\d{1,12}$/.test(input.timestamp) || !UUID_PATTERN.test(input.nonce) || !/^[0-9a-f]{64}$/.test(input.signature)) {
    return { ok: false, reason: "invalid_headers" };
  }
  const signedAtMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(signedAtMs) || Math.abs(input.nowMs - signedAtMs) > windowMs) {
    return { ok: false, reason: "expired_timestamp" };
  }
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const expected = Buffer.from(
    createHmac("sha256", input.secret)
      .update(["POST", CARTERA_EVENTS_PATH, input.timestamp, input.nonce, bodyHash].join("\n"))
      .digest("hex"),
  );
  const received = Buffer.from(input.signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true, expiresAtMs: signedAtMs + windowMs };
}

/**
 * Process-local replay guard. A nonce is remembered until its timestamp falls
 * out of the signature window, after which the timestamp check rejects it by
 * itself. Only nonces with a valid signature are recorded, so an
 * unauthenticated caller cannot fill it. It is per instance: with several
 * replicas a replay could land on another one, which is acceptable because the
 * event handler is idempotent.
 */
export class NonceReplayCache {
  private readonly entries = new Map<string, number>();

  constructor(private readonly maxEntries = 10_000) {}

  /** Returns false when the nonce was already seen and is still live. */
  claim(nonce: string, expiresAtMs: number, nowMs: number) {
    const key = nonce.toLowerCase();
    const existing = this.entries.get(key);
    if (existing !== undefined && existing >= nowMs) return false;
    this.prune(nowMs);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, expiresAtMs);
    return true;
  }

  private prune(nowMs: number) {
    for (const [key, expiresAtMs] of this.entries) {
      if (expiresAtMs < nowMs) this.entries.delete(key);
    }
  }
}

export function createCarteraEventsRouter(deps: {
  secret: string | undefined;
  tokenUsers: CarteraEventTokenUsers;
  now?: () => number;
  nonces?: NonceReplayCache;
  logInfo?: (message: string) => void;
}) {
  const router = new Hono();
  const now = deps.now ?? Date.now;
  const nonces = deps.nonces ?? new NonceReplayCache();
  const logInfo = deps.logInfo ?? console.log;
  const secret = deps.secret?.trim() ?? "";
  const configured = Buffer.byteLength(secret) >= MIN_SECRET_BYTES;

  router.post(
    CARTERA_EVENTS_PATH,
    async (c, next) => {
      if (!configured) {
        log(logInfo, null, "not-configured");
        return c.json({ error: "configuration_error" }, 503);
      }
      await next();
    },
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "invalid_body" }, 400),
    }),
    async (c) => {
      const requestId = crypto.randomUUID();
      let rawBody: string;
      try {
        rawBody = await c.req.text();
      } catch {
        // bodyLimit aborts the stream past MAX_BODY_BYTES (chunked uploads).
        log(logInfo, requestId, "invalid-body", { reason: "body_unreadable_or_too_large" });
        return c.json({ error: "invalid_body" }, 400);
      }
      const nonce = c.req.header("x-cartera-nonce") ?? "";
      const verified = verifyCarteraSignature({
        secret,
        timestamp: c.req.header("x-cartera-timestamp") ?? "",
        nonce,
        signature: c.req.header("x-cartera-signature") ?? "",
        body: rawBody,
        nowMs: now(),
      });
      if (!verified.ok) {
        log(logInfo, requestId, "unauthorized", { reason: verified.reason });
        return c.json({ error: "invalid_authentication" }, 401);
      }
      if (!nonces.claim(nonce, verified.expiresAtMs, now())) {
        log(logInfo, requestId, "unauthorized", { reason: "replayed_nonce" });
        return c.json({ error: "invalid_authentication" }, 401);
      }

      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        log(logInfo, requestId, "invalid-body", { reason: "malformed_json" });
        return c.json({ error: "invalid_body" }, 400);
      }
      const parsed = carteraEventSchema.safeParse(json);
      if (!parsed.success) {
        const type = typeof json === "object" && json !== null && "type" in json ? (json as { type: unknown }).type : undefined;
        log(logInfo, requestId, "invalid-body", {
          reason: typeof type === "string" && type !== "credit_cancelled" ? "unknown_type" : "schema_mismatch",
        });
        return c.json({ error: "invalid_body" }, 400);
      }

      const event = parsed.data;
      try {
        const deactivated = await deps.tokenUsers.deactivateByCreditoId(event.creditoId);
        log(logInfo, requestId, "credit-cancelled-applied", {
          eventId: event.eventId,
          creditoId: event.creditoId,
          deactivated,
        });
        return c.json({ status: "ok", eventId: event.eventId, deactivated });
      } catch (error) {
        log(logInfo, requestId, "failed", {
          eventId: event.eventId,
          creditoId: event.creditoId,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        return c.json({ error: "processing_failed" }, 500);
      }
    },
  );

  return router;
}

function log(logInfo: (message: string) => void, requestId: string | null, event: string, data: Record<string, unknown> = {}) {
  logInfo(JSON.stringify({ scope: "cartera-events", requestId, event, ...data }));
}
