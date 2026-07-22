import type { CarteraPaymentClient } from "./cartera-client";
import type { MockCreditLedger } from "./mock-ledger";

export class MockCarteraPaymentClient implements CarteraPaymentClient {
  constructor(private readonly ledger?: MockCreditLedger) {}

  async applyNexaPayment(input: Parameters<CarteraPaymentClient["applyNexaPayment"]>[0]) {
    if (this.ledger) {
      const applied = await this.ledger.applyPayment({
        creditoId: input.creditoId,
        amount: input.transaction.amount,
        reference: String(input.transaction.reference),
      });
      return { status: "APPLIED" as const, paymentId: applied.paymentId };
    }

    const numericReference = Number(input.transaction.reference);
    return {
      status: "APPLIED" as const,
      paymentId: Number.isFinite(numericReference) ? numericReference : Date.now(),
    };
  }
}
