import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { TokenTransaction } from "../nexa/schemas";

export type CarteraApplyPaymentResult =
  | { status: "APPLIED"; paymentId: number; idempotent?: boolean }
  | { status: "REJECTED"; reason: string };

type CarteraTransaction = Omit<TokenTransaction, "transactionId"> & { transactionId?: string | number | null };

export interface CarteraPaymentClient {
  applyNexaPayment(input: { creditoId: number; transaction: CarteraTransaction }): Promise<CarteraApplyPaymentResult>;
}

const applyPaymentResponseSchema = z.object({
  status: z.literal("APPLIED"),
  paymentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotent: z.boolean().optional(),
});
const safeErrorResponseSchema = z.object({ error: z.string().regex(/^[a-z0-9_]{1,64}$/) });

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CarteraPaymentRequestError extends Error {
  readonly retryable = true;
}

function formatAmount(amount: number) {
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

export class HttpCarteraPaymentClient implements CarteraPaymentClient {
  constructor(private readonly options: { baseUrl: string; secret: string; timeoutMs?: number; fetch?: Fetcher; clock?: () => number }) {}

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

    const fetcher = this.options.fetch ?? fetch;
    const path = "/internal/nexa/payments/apply";
    const body = JSON.stringify({
      externalReference,
      creditoId: input.creditoId,
      amount: formatAmount(input.transaction.amount),
      currency: "GTQ",
      ...(transactionId
        ? { transactionId }
        : {}),
    });
    const timestamp = String(Math.floor((this.options.clock?.() ?? Date.now()) / 1000));
    const nonce = randomUUID();
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const signature = createHmac("sha256", this.options.secret)
      .update(["POST", path, timestamp, nonce, bodyHash].join("\n"))
      .digest("hex");
    const response = await fetcher(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
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

    if (!response.ok) {
      const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
      const error = await response.json()
        .then((body: unknown) => safeErrorResponseSchema.safeParse(body))
        .catch(() => undefined);
      const retryableCode = error?.success && ["invalid_authentication", "configuration_error"].includes(error.data.error);
      if ([401, 408, 429].includes(response.status) || response.status >= 500 || (response.status === 403 && (!error?.success || retryableCode))) {
        throw new CarteraPaymentRequestError(`Cartera payment request failed: HTTP ${status}`);
      }
      return {
        status: "REJECTED",
        reason: `Cartera payment rejected: HTTP ${status}${error?.success ? ` (${error.data.error})` : ""}`,
      };
    }

    return applyPaymentResponseSchema.parse(await response.json());
  }
}
