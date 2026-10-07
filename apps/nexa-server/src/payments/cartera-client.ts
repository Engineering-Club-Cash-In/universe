import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { tokenDateSchema } from "../nexa/schemas";
export type CarteraApplyPaymentResult =
  | { status: "APPLIED"; paymentId: number; paymentIds?: number[]; idempotent?: boolean; billingStatus?: "PENDING" }
  | { status: "REJECTED"; reason: string };

export type CarteraRegisterTokenInput = {
  creditoId: number;
  token: string;
  identifier: string;
  nexaUserId: number;
};

export type CarteraRegisterTokenResult =
  | { status: "CREATED" | "UPDATED" | "UNCHANGED" }
  | { status: "REJECTED"; reason: string };

type CarteraTransaction = {
  reference: string | number;
  amount: number;
  currency: "GTQ" | "USD";
  tokenDate: string;
  transactionId?: string | number | null;
  token?: string;
};

export interface CarteraPaymentClient {
  applyNexaPayment(input: { creditoId: number; transaction: CarteraTransaction }): Promise<CarteraApplyPaymentResult>;
}

export interface CarteraTokenClient {
  registerNexaToken(input: CarteraRegisterTokenInput): Promise<CarteraRegisterTokenResult>;
}

const paymentIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const applyPaymentResponseSchema = z.object({
  status: z.literal("APPLIED"),
  paymentId: paymentIdSchema,
  // Cartera antigua no lo envía: la ausencia se conserva (undefined). Rellenar [paymentId] aquí
  // pisaría la lista múltiple ya guardada en un reintento de billing; el repositorio pone
  // [paymentId] solo al aplicar un pago nuevo.
  paymentIds: z.array(paymentIdSchema).min(1).optional(),
  idempotent: z.boolean().optional(),
  billingStatus: z.literal("PENDING").optional(),
}).transform((value, ctx) => {
  const { paymentIds } = value;
  if (paymentIds && !paymentIds.includes(value.paymentId)) {
    ctx.addIssue({ code: "custom", path: ["paymentIds"], message: "paymentIds must include paymentId" });
    return z.NEVER;
  }
  return value;
});
const safeErrorResponseSchema = z.object({
  error: z.string().regex(/^[a-z0-9_]{1,64}$/),
  // Qué pasó con la condonación a tiempo de la mora en un pago incierto. Un
  // valor desconocido (cartera más nueva) se ignora: nunca texto libre.
  condonacion: z.enum(["anulada", "conservada", "conservada_pago_posterior", "sin_verificar"]).optional().catch(undefined),
});

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CarteraPaymentRequestError extends Error {
  readonly retryable = true;

  /**
   * El código de cartera cuando el desenlace quedó incierto
   * (payment_outcome_uncertain, payment_amount_mismatch): el worker lo guarda
   * como failureReason en vez de un genérico, para que se vea en la revisión manual.
   */
  constructor(message: string, readonly reason?: string) {
    super(message);
  }
}

export function formatAmount(amount: number) {
  const value = String(amount);
  if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Cartera payment amount must be positive with at most two decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(2, "0");
  if (whole.length > 16 || BigInt(`${whole}${paddedFraction}`) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Cartera payment amount exceeds safe NUMERIC(18,2) limits");
  }
  return `${whole}.${paddedFraction}`;
}

export class HttpCarteraPaymentClient implements CarteraPaymentClient, CarteraTokenClient {
  constructor(private readonly options: { baseUrl: string; secret: string; timeoutMs?: number; fetch?: Fetcher; clock?: () => number }) {}

  private signedRequest(path: string, body: string) {
    const timestamp = String(Math.floor((this.options.clock?.() ?? Date.now()) / 1000));
    const nonce = randomUUID();
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const signature = createHmac("sha256", this.options.secret)
      .update(["POST", path, timestamp, nonce, bodyHash].join("\n"))
      .digest("hex");
    const fetcher = this.options.fetch ?? fetch;
    return fetcher(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nexa-timestamp": timestamp,
        "x-nexa-nonce": nonce,
        "x-nexa-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
  }

  async applyNexaPayment(input: { creditoId: number; transaction: CarteraTransaction }): Promise<CarteraApplyPaymentResult> {
    if (!Number.isInteger(input.creditoId) || input.creditoId <= 0) {
      throw new Error("creditoId must be a positive integer");
    }
    if (input.transaction.currency !== "GTQ") {
      throw new Error("Cartera payments require GTQ currency");
    }
    const externalReference = String(input.transaction.reference).trim();
    if (!externalReference || externalReference.length > 150) {
      throw new Error("externalReference must contain 1 to 150 characters");
    }
    const transactionId = input.transaction.transactionId == null
      ? ""
      : String(input.transaction.transactionId).trim();
    if (transactionId.length > 100) {
      throw new Error("transactionId must contain at most 100 characters");
    }

    const path = "/internal/nexa/payments/apply";
    const body = JSON.stringify({
      externalReference,
      creditoId: input.creditoId,
      amount: formatAmount(input.transaction.amount),
      currency: "GTQ",
      tokenDate: tokenDateSchema.parse(input.transaction.tokenDate),
      ...(transactionId
        ? { transactionId }
        : {}),
      ...(input.transaction.token && /^\d{10,32}$/.test(input.transaction.token) ? { token: input.transaction.token } : {}),
    });
    const response = await this.signedRequest(path, body);

    if (!response.ok) {
      const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
      const error = await response.json()
        .then((body: unknown) => safeErrorResponseSchema.safeParse(body))
        .catch(() => undefined);
      const retryableCode = error?.success && ["invalid_authentication", "configuration_error", "invalid_body"].includes(error.data.error);
      const uncertainCode = error?.success && ["payment_amount_mismatch", "payment_outcome_uncertain"].includes(error.data.error);
      if (uncertainCode || retryableCode || [401, 408, 429].includes(response.status) || response.status >= 500 || (response.status === 403 && !error?.success)) {
        throw new CarteraPaymentRequestError(
          `Cartera payment request failed: HTTP ${status}`,
          uncertainCode
            ? error.data.error === "payment_outcome_uncertain" && error.data.condonacion
              ? `payment_outcome_uncertain:condonacion_${error.data.condonacion}`
              : error.data.error
            : undefined,
        );
      }
      return {
        status: "REJECTED",
        reason: `Cartera payment rejected: HTTP ${status}${error?.success ? ` (${error.data.error})` : ""}`,
      };
    }

    return applyPaymentResponseSchema.parse(await response.json());
  }

  async registerNexaToken(input: CarteraRegisterTokenInput): Promise<CarteraRegisterTokenResult> {
    if (!Number.isInteger(input.creditoId) || input.creditoId <= 0) {
      throw new Error("creditoId must be a positive integer");
    }
    if (!/^\d{10,32}$/.test(input.token)) {
      throw new Error("token must be 10 to 32 digits");
    }
    if (!/^\d{9}$/.test(input.identifier)) {
      throw new Error("identifier must be exactly 9 digits");
    }
    if (!input.token.endsWith(input.identifier)) {
      throw new Error("token must end with identifier");
    }
    if (!Number.isInteger(input.nexaUserId) || input.nexaUserId <= 0) {
      throw new Error("nexaUserId must be a positive integer");
    }

    const path = "/internal/nexa/tokens";
    const body = JSON.stringify({
      creditoId: input.creditoId,
      token: input.token,
      identifier: input.identifier,
      nexaUserId: input.nexaUserId,
    });
    const response = await this.signedRequest(path, body);

    if (!response.ok) {
      const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
      const error = await response.json()
        .then((body: unknown) => safeErrorResponseSchema.safeParse(body))
        .catch(() => undefined);
      if ([401, 408, 429].includes(response.status) || response.status >= 500 || (error?.success && ["invalid_authentication", "configuration_error"].includes(error.data.error))) {
        throw new CarteraPaymentRequestError(`Cartera token request failed: HTTP ${status}`);
      }
      return {
        status: "REJECTED",
        reason: error?.success ? error.data.error : `http_${response.status}`,
      };
    }

    const registerTokenResponseSchema = z.object({
      status: z.enum(["CREATED", "UPDATED", "UNCHANGED"]),
    });
    return registerTokenResponseSchema.parse(await response.json());
  }
}
