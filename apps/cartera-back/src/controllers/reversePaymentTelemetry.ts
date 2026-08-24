import type {
  InvoiceVoidingResult,
  PaymentReversalResult,
} from "../utils/structuredLogger";

type PreviousPaymentState = "applied" | "pending" | "unknown";

interface PaymentReversalFailureInput {
  readonly errorMessage: string | undefined;
  readonly transactionCommitted: boolean;
  readonly mayHaveGlobalPersistence: boolean;
  readonly previousPaymentState: PreviousPaymentState;
  readonly investmentsReversed: boolean;
  readonly durationMs: number;
}

export function classifyPaymentReversalFailure(
  input: PaymentReversalFailureInput,
): Exclude<PaymentReversalResult, { readonly outcome: "completed" }> {
  if (input.transactionCommitted) {
    return {
      outcome: "partially_completed",
      previousPaymentState: input.previousPaymentState,
      creditUpdated: true,
      investmentsReversed: input.investmentsReversed,
      manualActionRequired: true,
      durationMs: input.durationMs,
      reasonCode: "manual_reconciliation_required",
    };
  }
  if (input.mayHaveGlobalPersistence) {
    return {
      outcome: "partially_completed",
      previousPaymentState: input.previousPaymentState,
      creditUpdated: false,
      investmentsReversed: input.investmentsReversed,
      manualActionRequired: true,
      durationMs: input.durationMs,
      reasonCode: "local_state_inconsistent",
    };
  }

  const common = {
    previousPaymentState: input.previousPaymentState,
    creditUpdated: false,
    investmentsReversed: input.investmentsReversed,
    durationMs: input.durationMs,
  };
  if (input.errorMessage === "Payment not found") {
    return { outcome: "rejected", ...common, manualActionRequired: false, reasonCode: "payment_not_found" };
  }
  if (input.errorMessage === "Credit not found or not active") {
    return { outcome: "rejected", ...common, manualActionRequired: false, reasonCode: "credit_not_found" };
  }
  if (input.errorMessage === "User not found") {
    return { outcome: "rejected", ...common, manualActionRequired: false, reasonCode: "user_not_found" };
  }
  if (
    input.errorMessage === "Payment is not marked as paid"
    || input.errorMessage === "Incobrable structural row cannot be reversed"
  ) {
    return { outcome: "rejected", ...common, manualActionRequired: false, reasonCode: "state_conflict" };
  }
  if (
    input.errorMessage?.startsWith("[ABONO_YA_LIQUIDADO]")
    || input.errorMessage?.startsWith("[ABONO_EN_CALCULO_PENDIENTE]")
  ) {
    return { outcome: "rejected", ...common, manualActionRequired: true, reasonCode: "manual_reconciliation_required" };
  }
  return {
    outcome: "failed",
    ...common,
    manualActionRequired: false,
    errorCode: "unknown",
  };
}

interface InvoiceVoidingBatchInput {
  readonly succeededCount: number;
  readonly providerRejectedCount: number;
  readonly unexpectedFailureCount: number;
  readonly localStateFailureCount: number;
  readonly durationMs: number;
}

export function classifyInvoiceVoidingBatch(
  input: InvoiceVoidingBatchInput,
): InvoiceVoidingResult {
  const failedCount = input.providerRejectedCount
    + input.unexpectedFailureCount
    + input.localStateFailureCount;
  const common = {
    processedCount: input.succeededCount + failedCount,
    succeededCount: input.succeededCount,
    failedCount,
    durationMs: input.durationMs,
  };
  if (input.localStateFailureCount > 0) {
    return {
      outcome: "local_state_inconsistent",
      ...common,
      manualActionRequired: true,
      errorCode: "persistence_failed",
    };
  }
  if (input.unexpectedFailureCount > 0) {
    return {
      outcome: "failed",
      ...common,
      manualActionRequired: true,
      errorCode: "unknown",
    };
  }
  if (input.providerRejectedCount > 0) {
    return {
      outcome: "provider_rejected",
      ...common,
      manualActionRequired: true,
      reasonCode: "provider_rejected",
    };
  }
  return {
    outcome: "completed",
    ...common,
    manualActionRequired: false,
  };
}
