import { describe, expect, test } from "bun:test";
import { buildSamplePaymentTokenWebhookPayload } from "./sample-payload";

describe("buildSamplePaymentTokenWebhookPayload", () => {
  test("builds a Nexa-compatible local webhook payload", () => {
    expect(buildSamplePaymentTokenWebhookPayload({
      id: 7293,
      reference: "4617307",
      token: "1234567310005010",
      amount: 50,
    })).toEqual({
      id: 7293,
      reference: "4617307",
      token: "1234567310005010",
      amount: 50,
      originAccount: "19451958",
      originBank: "INDLGTGC",
      comments: "Test transaction",
      currency: "GTQ",
      originAccountName: "Cuenta origen",
    });
  });
});
