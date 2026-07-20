import type { TokenTransaction } from "../nexa/schemas";

export type CarteraApplyPaymentResult =
  | { status: "APPLIED"; paymentId: number }
  | { status: "REJECTED"; reason: string };

export interface CarteraPaymentClient {
  applyNexaPayment(input: { creditoId: number; transaction: TokenTransaction }): Promise<CarteraApplyPaymentResult>;
}

export class HttpCarteraPaymentClient implements CarteraPaymentClient {
  constructor(private readonly options: { baseUrl: string; internalApiKey: string; fetch?: typeof fetch }) {}

  async applyNexaPayment(input: { creditoId: number; transaction: TokenTransaction }): Promise<CarteraApplyPaymentResult> {
    const fetcher = this.options.fetch ?? fetch;
    const response = await fetcher(`${this.options.baseUrl.replace(/\/$/, "")}/internal/nexa/payments/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.internalApiKey}`,
      },
      body: JSON.stringify({
        reference: String(input.transaction.reference),
        creditoId: input.creditoId,
        amount: input.transaction.amount,
        currency: input.transaction.currency,
        token: input.transaction.token,
        tokenIdentifier: input.transaction.tokenIdentifier,
        originBank: input.transaction.bank,
        originAccount: input.transaction.account,
        comments: input.transaction.comments,
        paidAt: input.transaction.tokenDate,
        raw: input.transaction,
      }),
    });

    if (!response.ok) {
      return { status: "REJECTED", reason: await response.text() };
    }

    return response.json();
  }
}
