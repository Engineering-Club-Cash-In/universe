import { expect, test } from "bun:test";
import { paymentTokenStatementResponseSchema, paymentTokenWebhookSchema } from "./schemas";

const statement = (amount: number) => ({
  transactions: [{
    reference: "statement-1",
    amount,
    bank: "INDLGTGC",
    comments: "",
    currency: "GTQ",
    account: "account",
    token: "12345100000001",
    tokenDate: "2026-09-08T12:00:00Z",
    tokenIdentifier: "100000001",
    tokenName: "Token",
    tokenPrefix: "12345",
    wasReturn: 0,
    transactionId: "7293",
  }],
});

const webhook = (amount: number) => ({
  id: 7293,
  reference: 4617307,
  token: "12345100000001",
  amount,
  originAccount: "account",
  originBank: "INDLGTGC",
  comments: "",
  currency: "GTQ",
  tokenDate: "2026-09-08T12:00:00Z",
});

test.each([10.001, 10.002])("rejects sub-cent statement and webhook amount %s", (amount) => {
  expect(paymentTokenStatementResponseSchema.safeParse(statement(amount)).success).toBe(false);
  expect(paymentTokenWebhookSchema.safeParse(webhook(amount)).success).toBe(false);
});

test("requires an offset-safe statement tokenDate without changing the date-less webhook contract", () => {
  const malformed = statement(10);
  malformed.transactions[0]!.tokenDate = "2026-09-08T12:00:00+24:00";
  expect(paymentTokenStatementResponseSchema.safeParse(malformed).success).toBe(false);
  expect(paymentTokenWebhookSchema.safeParse({ ...webhook(10), tokenDate: undefined }).success).toBe(true);
  expect(paymentTokenStatementResponseSchema.safeParse(statement(10)).success).toBe(true);
  expect(paymentTokenWebhookSchema.safeParse(webhook(10)).success).toBe(true);
});

test("accepts ordinary cent values without floating-point false positives", () => {
  expect(paymentTokenStatementResponseSchema.safeParse(statement(0.29)).success).toBe(true);
  expect(paymentTokenWebhookSchema.safeParse(webhook(0.29)).success).toBe(true);
});
