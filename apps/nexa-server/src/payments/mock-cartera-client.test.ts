import { describe, expect, test } from "bun:test";
import { MockCarteraPaymentClient } from "./mock-cartera-client";

describe("MockCarteraPaymentClient", () => {
  test("pretends a Nexa payment was applied", async () => {
    const result = await new MockCarteraPaymentClient().applyNexaPayment({
      creditoId: 123,
      transaction: {
        reference: "4617308",
        amount: 50,
        currency: "GTQ",
        transactionId: "",
      },
    });

    expect(result).toEqual({ status: "APPLIED", paymentId: 4617308 });
  });
});
