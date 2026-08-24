import { describe, expect, test } from "bun:test";
import {
  classifyInvoiceVoidingBatch,
  classifyPaymentReversalFailure,
} from "./reversePaymentTelemetry";

describe("payment reversal telemetry classification", () => {
  test("classifies known pre-effect rejections without raw errors", () => {
    expect(classifyPaymentReversalFailure({
      errorMessage: "Payment not found",
      transactionCommitted: false,
      mayHaveGlobalPersistence: false,
      previousPaymentState: "unknown",
      investmentsReversed: false,
      durationMs: 3,
    })).toEqual(expect.objectContaining({ outcome: "rejected", reasonCode: "payment_not_found", manualActionRequired: false }));
    expect(classifyPaymentReversalFailure({
      errorMessage: "[ABONO_YA_LIQUIDADO] synthetic business detail",
      transactionCommitted: false,
      mayHaveGlobalPersistence: false,
      previousPaymentState: "applied",
      investmentsReversed: false,
      durationMs: 4,
    })).toEqual(expect.objectContaining({ outcome: "rejected", reasonCode: "manual_reconciliation_required", manualActionRequired: true }));
  });

  test("partial global persistence dominates ordinary failure classification", () => {
    expect(classifyPaymentReversalFailure({
      errorMessage: "synthetic raw database detail",
      transactionCommitted: false,
      mayHaveGlobalPersistence: true,
      previousPaymentState: "pending",
      investmentsReversed: true,
      durationMs: 7,
    })).toEqual({
      outcome: "partially_completed",
      previousPaymentState: "pending",
      creditUpdated: false,
      investmentsReversed: true,
      manualActionRequired: true,
      durationMs: 7,
      reasonCode: "local_state_inconsistent",
    });
  });

  test("unknown pre-effect failures expose only a finite error code", () => {
    expect(classifyPaymentReversalFailure({
      errorMessage: "synthetic raw provider detail",
      transactionCommitted: false,
      mayHaveGlobalPersistence: false,
      previousPaymentState: "unknown",
      investmentsReversed: false,
      durationMs: 2,
    })).toEqual({
      outcome: "failed",
      previousPaymentState: "unknown",
      creditUpdated: false,
      investmentsReversed: false,
      manualActionRequired: false,
      durationMs: 2,
      errorCode: "unknown",
    });
  });

  test("a post-commit failure is one partial terminal without claiming local inconsistency", () => {
    expect(classifyPaymentReversalFailure({
      errorMessage: "synthetic response construction failure",
      transactionCommitted: true,
      mayHaveGlobalPersistence: true,
      previousPaymentState: "applied",
      investmentsReversed: true,
      durationMs: 10,
    })).toEqual({
      outcome: "partially_completed",
      previousPaymentState: "applied",
      creditUpdated: true,
      investmentsReversed: true,
      manualActionRequired: true,
      durationMs: 10,
      reasonCode: "manual_reconciliation_required",
    });
  });
});

describe("invoice voiding aggregate classification", () => {
  test("uses deterministic severity precedence and exact count invariant", () => {
    expect(classifyInvoiceVoidingBatch({ succeededCount: 2, providerRejectedCount: 1, unexpectedFailureCount: 1, localStateFailureCount: 1, durationMs: 9 })).toEqual({
      outcome: "local_state_inconsistent",
      processedCount: 5,
      succeededCount: 2,
      failedCount: 3,
      manualActionRequired: true,
      durationMs: 9,
      errorCode: "persistence_failed",
    });
    expect(classifyInvoiceVoidingBatch({ succeededCount: 1, providerRejectedCount: 1, unexpectedFailureCount: 1, localStateFailureCount: 0, durationMs: 8 }).outcome).toBe("failed");
    expect(classifyInvoiceVoidingBatch({ succeededCount: 1, providerRejectedCount: 1, unexpectedFailureCount: 0, localStateFailureCount: 0, durationMs: 7 }).outcome).toBe("provider_rejected");
    expect(classifyInvoiceVoidingBatch({ succeededCount: 2, providerRejectedCount: 0, unexpectedFailureCount: 0, localStateFailureCount: 0, durationMs: 6 }).outcome).toBe("completed");
  });
});
