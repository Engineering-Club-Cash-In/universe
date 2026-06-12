import { describe, expect, test } from "bun:test";
import { MockCarteraPaymentClient } from "./mock-cartera-client";

describe("MockCarteraPaymentClient", () => {
  test("pretends a Nexa payment was applied", async () => {
    const result = await new MockCarteraPaymentClient().applyNexaPayment({
      creditoId: 123,
      transaction: {
        reference: "4617308",
        amount: 50,
        bank: "INDLGTGC",
        comments: "Test transaction",
        currency: "GTQ",
        account: "19451958",
        token: "32200310005010",
        tokenDate: "2026-05-27T00:00:00.000Z",
        tokenIdentifier: "310005010",
        tokenName: "Credito 123",
        tokenPrefix: "32200",
        wasReturn: 0,
        transactionId: "",
      },
    });

    expect(result).toEqual({ status: "APPLIED", paymentId: 4617308 });
  });
});
