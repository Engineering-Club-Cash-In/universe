import { createHash } from "node:crypto";
import Big from "big.js";
import { z } from "zod";
import type { PaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { verifyNexaHmac } from "./nexaHmac";

export const nexaPaymentSchema = z
  .object({
    externalReference: z.string().trim().min(1).max(150),
    creditoId: z.number().int().positive().max(2_147_483_647),
    amount: z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,15})\.\d{2}$/),
    currency: z.literal("GTQ"),
    tokenDate: z.string().datetime({ offset: true })
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid tokenDate")
      .optional(),
    transactionId: z.string().trim().max(100).transform((value) => value || undefined).optional(),
    // Mismo formato que acepta el registro del token: prefijo variable + 9 dígitos.
    token: z.string().regex(/^\d{10,32}$/).optional(),
  })
  .strict();

type NexaCreditBinding = {
  activo: boolean;
  expires_at: Date | null;
  max_payment_amount: string | null;
  nexa_token?: string | null;
};

export const getNexaBindingRejection = (
  binding: NexaCreditBinding | null,
  amount: string,
  now: Date,
  token: string | undefined,
) => {
  if (!binding) return "binding_missing" as const;
  if (!binding.activo) return "binding_inactive" as const;
  if (binding.expires_at && binding.expires_at <= now) return "binding_expired" as const;
  if (!token) return "token_missing" as const;
  if (!binding.nexa_token) return "binding_token_missing" as const;
  if (token !== binding.nexa_token) return "token_mismatch" as const;
  if (binding.max_payment_amount && new Big(amount).gt(binding.max_payment_amount)) {
    return "amount_exceeds_binding" as const;
  }
  return null;
};

// Un pago SIN token no es un rechazo del banco: es un nexa-server que todavía
// no manda el token (cartera desplegada antes) o que lo omitió. Se responde 503
// porque nexa-server —la versión vieja y la nueva— reintenta todo >= 500 y
// convierte un 403 con código en REJECTED, lo que le DEVUELVE el dinero al
// cliente. binding_token_missing (auto-reparación) y token_mismatch siguen 403.
const nexaBindingRejectionError = (
  code: NonNullable<ReturnType<typeof getNexaBindingRejection>>,
) => new NexaPaymentError(code, code === "token_missing" ? 503 : 403);

export type NexaPaymentBody = z.infer<typeof nexaPaymentSchema>;

export type NexaPaymentContext = {
  nonce: string;
  payloadHash: string;
  eventFingerprint?: string;
  legacyPayloadHash?: string;
  now: Date;
};

export type NexaClaim =
  | { kind: "new" | "retry" | "billing"; eventId: number }
  | { kind: "applied"; paymentId: number; eventId?: number; billingStatus?: "PENDING" }
  | { kind: "manual_review"; phase?: "payment" | "billing" }
  | { kind: "conflict" | "replay" | "billing_failed" };

export type NexaBillingOutcome =
  | { kind: "billed" }
  | { kind: "pending" | "failed" | "unknown"; code: string };

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
    compatiblePayloadHashes?: string[];
  },
  billingIsRunning = false,
): NexaClaim => {
  if (nonceUsed) return { kind: "replay" };
  if (!event) throw new Error("nexa event claim missing");
  if (
    event.credito_id !== requested.creditoId ||
    !new Big(event.amount).eq(requested.amount) ||
    event.currency !== requested.currency ||
    ![requested.payloadHash, ...(requested.compatiblePayloadHashes ?? [])].includes(event.payload_hash)
  ) {
    return { kind: "conflict" };
  }
  if (["applied", "billed"].includes(event.status) && event.pago_id !== null) {
    return { kind: "applied", paymentId: event.pago_id, eventId: event.id };
  }
  if (event.status === "failed") return { kind: "retry", eventId: event.id };
  // Preserve a durable rejection across polls instead of resetting Nexa's retry budget with PENDING.
  if (event.status === "billing_failed") return { kind: "billing_failed" };
  if (event.status === "billing_pending" && event.pago_id !== null) {
    return { kind: "billing", eventId: event.id };
  }
  if (event.status === "billing_running" && billingIsRunning && event.pago_id !== null) {
    return { kind: "applied", paymentId: event.pago_id, eventId: event.id, billingStatus: "PENDING" };
  }
  if (["billing_running", "billing_unknown"].includes(event.status)) {
    return { kind: "manual_review", phase: "billing" };
  }
  return { kind: "manual_review" };
};

type NexaPaymentResult = {
  paymentId: number;
  /** Todos los pago_id del evento (ascendente); paymentId es el primero. */
  paymentIds: number[];
  idempotent: boolean;
  billingStatus?: "PENDING";
};

export const getNexaReceiptFields = (body: NexaPaymentBody) => {
  if (!body.tokenDate) throw new NexaPaymentError("payment_date_required", 503);
  // Nexa statements supply a banking calendar date, not a local receipt time.
  // Keep the original bank value for audit; do not shift the statement day.
  return {
    fecha_pago: body.tokenDate,
    fecha_boleta: body.tokenDate.slice(0, 10),
    numeroAutorizacion: body.transactionId || body.externalReference,
  };
};

export type NexaPaymentDependencies = {
  withCreditLock: (
    creditoId: number,
    work: (lock: PaymentAdvisoryLock) => Promise<NexaPaymentResult>,
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
    amount: string;
  }[]>;
  registerPayment: (
    body: NexaPaymentBody,
    eventId: number,
    usuarioId: number,
    validateAfterLock: () => Promise<void>,
    paymentLock: PaymentAdvisoryLock,
  ) => Promise<{ success?: boolean; code?: string; status?: number }>;
  applyPayment: (
    paymentId: number,
    paymentLock: PaymentAdvisoryLock,
  ) => Promise<{ success?: boolean }>;
  complete: (eventId: number, paymentId: number) => Promise<void>;
  fail: (eventId: number, code: string) => Promise<void>;
  billPayments?: (eventId: number, paymentIds: number[]) => Promise<NexaBillingOutcome>;
  completeBilling?: (eventId: number, paymentId: number) => Promise<void>;
  failBilling?: (
    eventId: number,
    status: "billing_failed" | "billing_unknown",
    code: string,
  ) => Promise<void>;
  now?: () => Date;
};

export const canAutomaticallyInvoiceNexa = ({
  environment,
  enabled,
  simulated,
}: {
  environment: string;
  enabled: boolean;
  simulated: boolean;
}) => environment.toLowerCase() === "production" && enabled && !simulated;

export const classifyNexaBillingResponse = (
  status: number,
  response: unknown,
): NexaBillingOutcome => {
  if (!response || typeof response !== "object") {
    return { kind: "unknown", code: "invalid_billing_response" };
  }
  const result = response as Record<string, unknown>;
  if (result.success === true) {
    if (status < 200 || status >= 300 || !result.data || typeof result.data !== "object") {
      return { kind: "unknown", code: "invalid_billing_response" };
    }
    const data = result.data as Record<string, unknown>;
    if (Array.isArray(data.errores) && data.errores.length > 0) {
      return { kind: "unknown", code: "partial_billing_result" };
    }
    if (
      typeof data.total_facturas !== "number" ||
      !Number.isInteger(data.total_facturas) ||
      !Array.isArray(data.facturas) ||
      data.total_facturas !== data.facturas.length ||
      data.facturas.some((invoice) => {
        if (!invoice || typeof invoice !== "object") return true;
        const id = (invoice as Record<string, unknown>).factura_id;
        return typeof id !== "number" || !Number.isInteger(id) || id <= 0;
      })
    ) {
      return { kind: "unknown", code: "invalid_billing_response" };
    }
    return { kind: "billed" };
  }
  if (status >= 400 && status < 500 && !("facturasExistentes" in result)) {
    return { kind: "failed", code: "billing_rejected" };
  }
  return { kind: "unknown", code: "billing_provider_or_persistence_error" };
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
) => dependencies.withCreditLock(body.creditoId, async (paymentLock) => {
  const existingCredit = await dependencies.loadCredit(body.creditoId);
  if (!existingCredit) throw new NexaPaymentError("credit_not_found", 404);
  const claim = await dependencies.claim(body, context);
  if ("paymentId" in claim) {
    // Buscar por nexa_payment_event_id: nexa_payment_events.pago_id solo guarda el primero y puede ser NULL.
    const linked = claim.eventId === undefined
      ? []
      : (await dependencies.findPayments?.(claim.eventId, body.creditoId)) ?? [];
    const paymentIds = [...new Set([claim.paymentId, ...linked.map((payment) => payment.paymentId)])]
      .sort((a, b) => a - b);
    return { paymentId: claim.paymentId, paymentIds, idempotent: true, ...(claim.billingStatus ? { billingStatus: claim.billingStatus } : {}) };
  }
  if (claim.kind === "billing_failed") throw new NexaPaymentError("billing_failed", 503);
  if (claim.kind === "manual_review") {
    throw new NexaPaymentError(
      claim.phase === "billing" ? "billing_outcome_unknown" : "payment_outcome_uncertain",
      503,
    );
  }
  if (!("eventId" in claim)) {
    throw new NexaPaymentError(claim.kind, 409);
  }
  const eventId = claim.eventId;
  let payments: Awaited<ReturnType<NexaPaymentDependencies["findPayments"]>>;

  if (claim.kind === "billing") {
    if (!dependencies.failBilling) throw new NexaPaymentError("billing_not_configured", 503);
    try {
      payments = await dependencies.findPayments(eventId, body.creditoId);
      if (payments.length === 0) throw new Error("linked payments missing");
      const linkedAmount = payments.reduce((total, payment) => total.plus(payment.amount), new Big(0));
      if (!linkedAmount.eq(body.amount)) throw new Error("linked payment amount mismatch");
    } catch {
      await dependencies.failBilling(eventId, "billing_unknown", "billing_payment_link_unknown");
      throw new NexaPaymentError("billing_outcome_unknown", 503);
    }
  } else {
    try {
      if (!body.tokenDate) throw new NexaPaymentError("payment_date_required", 503);
      const credit = await dependencies.loadCredit(body.creditoId);
      if (!credit) throw new NexaPaymentError("credit_not_found", 404);
      const bindingRejection = getNexaBindingRejection(
        credit.binding,
        body.amount,
        dependencies.now?.() ?? new Date(),
        body.token,
      );
      if (bindingRejection) throw nexaBindingRejectionError(bindingRejection);
      if (!["ACTIVO", "MOROSO", "EN_CONVENIO", "INCOBRABLE"].includes(credit.statusCredit)) {
        throw new NexaPaymentError("credit_not_payable", 409);
      }

      payments = await dependencies.findPayments(eventId, body.creditoId);
      if (payments.length === 0) {
        let registered: Awaited<ReturnType<NexaPaymentDependencies["registerPayment"]>>;
        try {
          registered = await dependencies.registerPayment(
            body,
            eventId,
            credit.usuarioId,
            async () => {
              const currentCredit = await dependencies.loadCredit(body.creditoId);
              if (!currentCredit) throw new NexaPaymentError("credit_not_found", 404);
              const rejection = getNexaBindingRejection(
                currentCredit.binding,
                body.amount,
                dependencies.now?.() ?? new Date(),
                body.token,
              );
              if (rejection) throw nexaBindingRejectionError(rejection);
            },
            paymentLock,
          );
        } catch (error) {
          if (error instanceof NexaPaymentError) throw error;
          throw new NexaPaymentError("payment_outcome_uncertain", 503);
        }
        payments = await dependencies.findPayments(eventId, body.creditoId);
        if (payments.length === 0) {
          throw registered.success === false
            ? new NexaPaymentError(
                registered.code ?? "payment_registration_rejected",
                registered.status ?? 409,
              )
            : new NexaPaymentError("payment_outcome_uncertain", 503);
        }
      }
      const linkedAmount = payments.reduce((total, payment) => total.plus(payment.amount), new Big(0));
      if (!linkedAmount.eq(body.amount)) {
        throw new NexaPaymentError("payment_outcome_uncertain", 503);
      }

      for (const payment of payments) {
        if (["validated", "capital_validated"].includes(payment.validationStatus)) continue;
        const applied = await dependencies.applyPayment(payment.paymentId, paymentLock);
        if (applied.success !== true) throw new NexaPaymentError("payment_not_applied", 409);
      }
      await dependencies.complete(eventId, payments[0]!.paymentId);
    } catch (error) {
      const code = error instanceof NexaPaymentError ? error.code : "processing_failed";
      await dependencies.fail(eventId, code);
      throw error;
    }
  }

  const paymentId = payments[0]!.paymentId;
  const paymentIds = payments.map((payment) => payment.paymentId);
  if (!dependencies.billPayments || !dependencies.completeBilling || !dependencies.failBilling) {
    throw new NexaPaymentError("billing_not_configured", 503);
  }
  let billing: NexaBillingOutcome;
  try {
    billing = await dependencies.billPayments(
      eventId,
      payments.map((payment) => payment.paymentId),
    );
    if (billing.kind === "billed") {
      await dependencies.completeBilling(eventId, paymentId);
      return { paymentId, paymentIds, idempotent: false };
    }
    if (billing.kind === "pending") {
      return { paymentId, paymentIds, idempotent: false, billingStatus: "PENDING" };
    }
    await dependencies.failBilling(
      eventId,
      billing.kind === "failed" ? "billing_failed" : "billing_unknown",
      billing.code,
    );
    throw new NexaPaymentError(
      billing.kind === "failed" ? "billing_failed" : "billing_outcome_unknown",
      503,
    );
  } catch (error) {
    if (error instanceof NexaPaymentError) throw error;
    try {
      await dependencies.failBilling(eventId, "billing_unknown", "billing_persistence_unknown");
    } catch {
      // billing_running is itself the durable fail-closed fence when this write fails.
    }
    throw new NexaPaymentError("billing_outcome_unknown", 503);
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
        payloadHash: hashNexaPayload(rawBody),
        eventFingerprint: getNexaEventFingerprint(parsed.data),
        legacyPayloadHash: hashNexaPayload(JSON.stringify(getLegacyNexaPaymentBody(parsed.data))),
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

const hashNexaPayload = (payload: string) => createHash("sha256").update(payload).digest("hex");

export const getNexaEventFingerprint = (body: NexaPaymentBody) => body.tokenDate
  ? hashNexaPayload(JSON.stringify([
      "nexa-payment-v2",
      body.externalReference,
      body.creditoId,
      body.amount,
      body.currency,
      body.transactionId ?? "",
      body.tokenDate,
    ]))
  : hashNexaPayload(JSON.stringify(getLegacyNexaPaymentBody(body)));

const getLegacyNexaPaymentBody = (body: NexaPaymentBody) => ({
  externalReference: body.externalReference,
  creditoId: body.creditoId,
  amount: body.amount,
  currency: body.currency,
  ...(body.transactionId ? { transactionId: body.transactionId } : {}),
});
