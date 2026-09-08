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
  paymentId: z.number(),
  idempotent: z.boolean().optional(),
});
const safeErrorResponseSchema = z.object({ error: z.string().regex(/^[a-z0-9_]{1,64}$/) });

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
  constructor(private readonly options: { baseUrl: string; secret: string; fetch?: Fetcher; clock?: () => number }) {}

  async applyNexaPayment(input: { creditoId: number; transaction: CarteraTransaction }): Promise<CarteraApplyPaymentResult> {
    if (!Number.isInteger(input.creditoId) || input.creditoId <= 0) {
      throw new Error("creditoId must be a positive integer");
    }
    if (input.transaction.currency !== "GTQ") {
      throw new Error("Cartera payments require GTQ currency");
    }

    const fetcher = this.options.fetch ?? fetch;
    const path = "/internal/nexa/payments/apply";
    const body = JSON.stringify({
      externalReference: String(input.transaction.reference),
      creditoId: input.creditoId,
      amount: formatAmount(input.transaction.amount),
      currency: "GTQ",
      ...(input.transaction.transactionId !== null && input.transaction.transactionId !== undefined && input.transaction.transactionId !== ""
        ? { transactionId: String(input.transaction.transactionId) }
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
    });

    if (!response.ok) {
      const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
      const error = await response.json()
        .then((body: unknown) => safeErrorResponseSchema.safeParse(body))
        .catch(() => undefined);
      return {
        status: "REJECTED",
        reason: `Cartera payment rejected: HTTP ${status}${error?.success ? ` (${error.data.error})` : ""}`,
      };
    }

    return applyPaymentResponseSchema.parse(await response.json());
  }
}
