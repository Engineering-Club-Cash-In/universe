import type { CarteraPaymentClient, CarteraRegisterTokenInput, CarteraTokenClient } from "./cartera-client";
import type { MockCreditLedger } from "./mock-ledger";

export class MockCarteraPaymentClient implements CarteraPaymentClient, CarteraTokenClient {
  constructor(private readonly ledger?: MockCreditLedger) {}

  async applyNexaPayment(input: Parameters<CarteraPaymentClient["applyNexaPayment"]>[0]) {
    if (this.ledger) {
      const applied = await this.ledger.applyPayment({
        creditoId: input.creditoId,
        amount: input.transaction.amount,
        reference: String(input.transaction.reference),
      });
      return { status: "APPLIED" as const, paymentId: applied.paymentId, paymentIds: [applied.paymentId] };
    }

    const numericReference = Number(input.transaction.reference);
    const paymentId = Number.isFinite(numericReference) ? numericReference : Date.now();
    return { status: "APPLIED" as const, paymentId, paymentIds: [paymentId] };
  }

  async registerNexaToken(_input: CarteraRegisterTokenInput) {
    return { status: "CREATED" as const };
  }
}
