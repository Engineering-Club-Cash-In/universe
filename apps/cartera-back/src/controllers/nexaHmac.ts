import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type NexaHmacInput = {
  method: string;
  path: string;
  body: string;
  secret: string;
  timestamp: string;
  nonce: string;
  signature: string;
  now?: number;
  windowSeconds?: number;
};

export const verifyNexaHmac = (input: NexaHmacInput) => {
  const windowSeconds = input.windowSeconds ?? 300;
  if (
    !/^\d+$/.test(input.timestamp) ||
    input.nonce.length === 0 ||
    input.nonce.length > 150 ||
    !/^[a-f\d]{64}$/i.test(input.signature) ||
    !Number.isFinite(windowSeconds) ||
    windowSeconds <= 0
  ) {
    return { ok: false, reason: "invalid_headers" } as const;
  }
  const now = input.now ?? Date.now();
  const windowMs = windowSeconds * 1000;
  const signedAt = Number(input.timestamp) * 1000;
  if (!Number.isFinite(signedAt) || Math.abs(now - signedAt) > windowMs) {
    return { ok: false, reason: "expired_timestamp" } as const;
  }

  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const canonical = [
    input.method,
    input.path,
    input.timestamp,
    input.nonce,
    bodyHash,
  ].join("\n");
  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(canonical).digest("hex"),
  );
  const received = Buffer.from(input.signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "invalid_signature" } as const;
  }
  return { ok: true } as const;
};
