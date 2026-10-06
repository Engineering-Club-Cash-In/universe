import { verifyNexaHmac } from "./nexaHmac";
import {
  nexaTokenSchema,
  processNexaTokenRegistration,
  NexaTokenError,
  type NexaTokenDependencies,
} from "./nexaTokens";

export const createNexaTokenHandler = ({
  secret,
  windowSeconds = 300,
  now = Date.now,
  dependencies,
}: {
  secret: string;
  windowSeconds?: number;
  now?: () => number;
  dependencies: NexaTokenDependencies;
}) => async ({ request, set }: {
  request: Request;
  body: unknown;
  set: { status?: number | string };
}) => {
  const normalizedSecret = secret.trim();
  if (normalizedSecret.length < 32 || Buffer.byteLength(normalizedSecret) < 32) {
    set.status = 503;
    return { error: "configuration_error" };
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-nexa-timestamp") ?? "";
  const nonce = request.headers.get("x-nexa-nonce") ?? "";
  const signature = request.headers.get("x-nexa-signature") ?? "";
  const verified = verifyNexaHmac({
    method: request.method,
    path: new URL(request.url).pathname,
    body: rawBody,
    secret: normalizedSecret,
    timestamp,
    nonce,
    signature,
    now: now(),
    windowSeconds,
  });
  if (!verified.ok || !nonce) {
    set.status = 401;
    return { error: "invalid_authentication" };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    set.status = 400;
    return { error: "invalid_body" };
  }
  const parsed = nexaTokenSchema.safeParse(json);
  if (!parsed.success) {
    set.status = 400;
    return { error: "invalid_body" };
  }

  try {
    const result = await processNexaTokenRegistration(
      parsed.data,
      nonce,
      dependencies,
    );
    set.status = result === "created" ? 201 : 200;
    return { status: result.toUpperCase(), creditoId: parsed.data.creditoId };
  } catch (error) {
    set.status = error instanceof NexaTokenError ? error.status : 500;
    return {
      error: error instanceof NexaTokenError ? error.code : "processing_failed",
    };
  }
};
