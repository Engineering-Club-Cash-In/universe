import { createHash } from "node:crypto";
import Big from "big.js";
import { z } from "zod";
import { verifyNexaHmac } from "./nexaHmac";

export const nexaPaymentSchema = z
  .object({
    externalReference: z.string().trim().min(1).max(150),
    creditoId: z.number().int().positive(),
    amount: z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,15})\.\d{2}$/),
    currency: z.literal("GTQ"),
    transactionId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

type NexaCreditBinding = {
  activo: boolean;
  expires_at: Date | null;
  max_payment_amount: string | null;
};

export const getNexaBindingRejection = (
  binding: NexaCreditBinding | null,
  amount: string,
  now: Date,
) => {
  if (!binding) return "binding_missing" as const;
  if (!binding.activo) return "binding_inactive" as const;
  if (binding.expires_at && binding.expires_at <= now) return "binding_expired" as const;
  if (binding.max_payment_amount && new Big(amount).gt(binding.max_payment_amount)) {
    return "amount_exceeds_binding" as const;
  }
  return null;
};

export type NexaPaymentBody = z.infer<typeof nexaPaymentSchema>;

export type NexaPaymentContext = {
  nonce: string;
  payloadHash: string;
  now: Date;
};

export type NexaClaim =
  | { kind: "new" | "retry"; eventId: number }
  | { kind: "applied"; paymentId: number }
  | { kind: "conflict" | "replay" };

export type StoredNexaEvent = {
  id: number;
  credito_id: number;
  amount: string;
  currency: string;
  payload_hash: string;
  status: string;
  pago_id: number | null;
};

export const classifyNexaClaim = (
  event: StoredNexaEvent | null,
  nonceUsed: boolean,
  requested: {
    creditoId: number;
    amount: string;
    currency: string;
    payloadHash: string;
  },
): NexaClaim => {
  if (nonceUsed) return { kind: "replay" };
  if (!event) throw new Error("nexa event claim missing");
  if (
    event.credito_id !== requested.creditoId ||
    !new Big(event.amount).eq(requested.amount) ||
    event.currency !== requested.currency ||
    event.payload_hash !== requested.payloadHash
  ) {
    return { kind: "conflict" };
  }
  if (event.status === "applied" && event.pago_id !== null) {
    return { kind: "applied", paymentId: event.pago_id };
  }
  return { kind: "retry", eventId: event.id };
};

type NexaPaymentResult = { paymentId: number; idempotent: boolean };

export const formatNexaPaymentDate = (date: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export type NexaPaymentDependencies = {
  withCreditLock: (
    creditoId: number,
    work: () => Promise<NexaPaymentResult>,
  ) => Promise<NexaPaymentResult>;
  claim: (body: NexaPaymentBody, context: NexaPaymentContext) => Promise<NexaClaim>;
  loadCredit: (creditoId: number) => Promise<{
    usuarioId: number;
    statusCredit: string;
    binding: NexaCreditBinding | null;
  } | null>;
  findPayments: (eventId: number, creditoId: number) => Promise<{
    paymentId: number;
    validationStatus: string;
  }[]>;
  registerPayment: (
    body: NexaPaymentBody,
    eventId: number,
    usuarioId: number,
  ) => Promise<void>;
  applyPayment: (paymentId: number) => Promise<{ success?: boolean }>;
  complete: (eventId: number, paymentId: number) => Promise<void>;
  fail: (eventId: number, code: string) => Promise<void>;
};

export class NexaPaymentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export const processNexaPayment = (
  body: NexaPaymentBody,
  context: NexaPaymentContext,
  dependencies: NexaPaymentDependencies,
) => dependencies.withCreditLock(body.creditoId, async () => {
  const claim = await dependencies.claim(body, context);
  if ("paymentId" in claim) {
    return { paymentId: claim.paymentId, idempotent: true };
  }
  if (!("eventId" in claim)) {
    throw new NexaPaymentError(claim.kind, 409);
  }
  const eventId = claim.eventId;

  try {
    const credit = await dependencies.loadCredit(body.creditoId);
    if (!credit) throw new NexaPaymentError("credit_not_found", 404);
    const bindingRejection = getNexaBindingRejection(credit.binding, body.amount, context.now);
    if (bindingRejection) throw new NexaPaymentError(bindingRejection, 403);
    if (!["ACTIVO", "MOROSO", "EN_CONVENIO", "INCOBRABLE"].includes(credit.statusCredit)) {
      throw new NexaPaymentError("credit_not_payable", 409);
    }

    let payments = await dependencies.findPayments(eventId, body.creditoId);
    if (payments.length === 0) {
      await dependencies.registerPayment(body, eventId, credit.usuarioId);
      payments = await dependencies.findPayments(eventId, body.creditoId);
    }
    if (payments.length === 0) throw new NexaPaymentError("payment_not_created", 500);

    for (const payment of payments) {
      if (["validated", "capital_validated"].includes(payment.validationStatus)) continue;
      const applied = await dependencies.applyPayment(payment.paymentId);
      if (!applied.success) throw new NexaPaymentError("payment_not_applied", 409);
    }
    await dependencies.complete(eventId, payments[0]!.paymentId);
    return { paymentId: payments[0]!.paymentId, idempotent: false };
  } catch (error) {
    const code = error instanceof NexaPaymentError ? error.code : "processing_failed";
    await dependencies.fail(eventId, code);
    throw error;
  }
});

export const createNexaPaymentHandler = ({
  secret,
  windowSeconds = 300,
  now = Date.now,
  dependencies,
}: {
  secret: string;
  windowSeconds?: number;
  now?: () => number;
  dependencies: NexaPaymentDependencies;
}) => async ({ request, set }: {
  request: Request;
  body: unknown;
  set: { status?: number | string };
}) => {
  if (!secret) {
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
    secret,
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
  const parsed = nexaPaymentSchema.safeParse(json);
  if (!parsed.success) {
    set.status = 400;
    return { error: "invalid_body" };
  }

  try {
    const result = await processNexaPayment(
      parsed.data,
      {
        nonce,
        payloadHash: createHash("sha256").update(rawBody).digest("hex"),
        now: new Date(now()),
      },
      dependencies,
    );
    set.status = 200;
    return { status: "APPLIED" as const, ...result };
  } catch (error) {
    set.status = error instanceof NexaPaymentError ? error.status : 500;
    return {
      error: error instanceof NexaPaymentError ? error.code : "processing_failed",
    };
  }
};
