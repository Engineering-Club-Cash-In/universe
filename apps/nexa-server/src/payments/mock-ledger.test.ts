import { describe, expect, test } from "bun:test";
import { MockCarteraPaymentClient } from "./mock-cartera-client";
import type { MockCreditLedger } from "./mock-ledger";

describe("mock cartera ledger", () => {
  test("reduces a mock credit balance when a payment is applied", async () => {
    const ledger: MockCreditLedger = {
      applyPayment: async (input) => ({
        paymentId: 7001,
        creditoId: input.creditoId,
        currentBalance: 950,
        totalPaid: 50,
      }),
    };

    const result = await new MockCarteraPaymentClient(ledger).applyNexaPayment({
      creditoId: 123,
      transaction: {
        reference: "4617309",
        amount: 50,
        currency: "GTQ",
        transactionId: "",
      },
    });

    expect(result).toEqual({ status: "APPLIED", paymentId: 7001 });
  });
});
