import { expect, test } from "bun:test";
import type { TokenTransaction } from "../nexa/schemas";
import { pollPaymentTokenDate } from "./poller";

test("poller upserts a FAILED reference once without processing or reviewing it", async () => {
  const persisted: TokenTransaction[] = [];
  const transaction: TokenTransaction = {
    reference: 1234,
    amount: 150,
    bank: "BI",
    comments: "Pago",
    currency: "GTQ",
    account: "001",
    token: "1234567000000001",
    tokenDate: "2026-05-04T10:00:00-06:00",
    tokenIdentifier: "000000001",
    tokenName: "Credito 42",
    tokenPrefix: "1234567",
    wasReturn: 0,
    transactionId: "9876",
  };

  const result = await pollPaymentTokenDate({
    date: "2026-05-04",
    nexa: {
      getPaymentTokenStatement: async () => ({ transactions: [transaction] }),
      reviewTransfer: async () => { throw new Error("reviewTransfer must not run during ingestion"); },
    },
    cartera: { applyNexaPayment: async () => { throw new Error("Cartera must not run during ingestion"); } },
    transactions: {
      upsertReceived: async (value) => {
        persisted.push(value);
        return { id: 1, reference: String(value.reference), processingStatus: "FAILED", created: false };
      },
      markApplied: async () => undefined,
      markRejected: async () => undefined,
      markFailed: async () => undefined,
    },
    tokenUsers: { findByToken: async () => { throw new Error("Token lookup must not run during ingestion"); } },
  });

  expect(persisted).toEqual([{ ...transaction, reference: "1234" }]);
  expect(result).toEqual({ found: 1, created: 0, applied: 0, rejected: 0, skipped: 1, failed: 0 });
});
