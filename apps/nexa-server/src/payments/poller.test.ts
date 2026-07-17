import { describe, expect, test } from "bun:test";
import { pollPaymentTokenDate } from "./poller";
import type { PaymentTransactionRepository, TokenUserRepository } from "./repositories";

describe("pollPaymentTokenDate", () => {
  test("applies a new incoming payment through cartera without review when statement has no transfer id", async () => {
    const savedReferences: string[] = [];
    const repository: PaymentTransactionRepository = {
      existsByReference: async () => false,
      createPending: async (transaction) => {
        savedReferences.push(String(transaction.reference));
        return { id: 1, ...transaction };
      },
      markApplied: async () => undefined,
      markRejected: async () => undefined,
      markFailed: async () => undefined,
    };
    const tokenUsers: TokenUserRepository = {
      findByToken: async () => ({ creditoId: 42 }),
    };
    const reviewStatuses: string[] = [];

    const result = await pollPaymentTokenDate({
      date: "2026-05-04",
      nexa: {
        getPaymentTokenStatement: async () => ({
          transactions: [{
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
            transactionId: "",
          }],
        }),
        reviewTransfer: async () => { throw new Error("should not review statements without transfer id"); },
      },
      cartera: {
        applyNexaPayment: async () => ({ status: "APPLIED", paymentId: 99 }),
      },
      transactions: repository,
      tokenUsers,
    });

    expect(savedReferences).toEqual(["1234"]);
    expect(reviewStatuses).toEqual([]);
    expect(result).toEqual({ found: 1, created: 1, applied: 1, rejected: 0, skipped: 0, failed: 0 });
  });

  test("reviews a statement payment when Nexa includes a numeric transfer id", async () => {
    const reviewPayloads: Array<{ id: number; reference: number; status: string }> = [];

    const result = await pollPaymentTokenDate({
      date: "2026-05-04",
      nexa: {
        getPaymentTokenStatement: async () => ({
          transactions: [{
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
          }],
        }),
        reviewTransfer: async (payload) => {
          reviewPayloads.push(payload);
          return { reference: payload.reference, status: payload.status };
        },
      },
      cartera: {
        applyNexaPayment: async () => ({ status: "APPLIED", paymentId: 99 }),
      },
      transactions: {
        existsByReference: async () => false,
        createPending: async (transaction) => ({ id: 1, ...transaction }),
        markApplied: async () => undefined,
        markRejected: async () => undefined,
        markFailed: async () => undefined,
      },
      tokenUsers: {
        findByToken: async () => ({ creditoId: 42 }),
      },
    });

    expect(reviewPayloads).toEqual([{ id: 9876, reference: 1234, status: "APPROVED" }]);
    expect(result).toEqual({ found: 1, created: 1, applied: 1, rejected: 0, skipped: 0, failed: 0 });
  });

  test("skips references already processed", async () => {
    const result = await pollPaymentTokenDate({
      date: "2026-05-04",
      nexa: {
        getPaymentTokenStatement: async () => ({
          transactions: [{
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
            transactionId: "",
          }],
        }),
        reviewTransfer: async () => { throw new Error("should not review duplicates"); },
      },
      cartera: {
        applyNexaPayment: async () => { throw new Error("should not apply duplicates"); },
      },
      transactions: {
        existsByReference: async () => true,
        createPending: async () => { throw new Error("should not save duplicates"); },
        markApplied: async () => undefined,
        markRejected: async () => undefined,
        markFailed: async () => undefined,
      },
      tokenUsers: {
        findByToken: async () => ({ creditoId: 42 }),
      },
    });

    expect(result.skipped).toBe(1);
  });
});
