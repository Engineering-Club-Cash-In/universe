import {
  carteraCatalog,
  createStructuredLogger,
  type Environment,
  type StructuredLoggerConfig,
} from "@repo/structured-logger";

interface CarteraStructuredLoggerOptions {
  readonly environment?: Environment;
  readonly clock?: StructuredLoggerConfig["clock"];
  readonly sink?: StructuredLoggerConfig["sink"];
}

export function resolveCarteraLogEnvironment(value: string | undefined): Environment {
  switch (value?.toLowerCase()) {
    case "dev":
    case "development":
      return "development";
    case "staging":
      return "staging";
    case "prod":
    case "production":
      return "production";
    case "local":
    default:
      return "local";
  }
}

export function createCarteraStructuredLogger(options: CarteraStructuredLoggerOptions = {}) {
  return createStructuredLogger(carteraCatalog, {
    service: "cartera-back",
    environment: options.environment ?? resolveCarteraLogEnvironment(
      process.env.LOG_ENVIRONMENT ?? process.env.NODE_ENV,
    ),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.sink ? { sink: options.sink } : {}),
  });
}

export type CarteraStructuredLogger = ReturnType<typeof createCarteraStructuredLogger>;

interface CreditCapitalPaymentAuditCompleted {
  readonly processedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly durationMs: number;
}

interface CreditCapitalPaymentAuditFailed {
  readonly operation: "query" | "diagnostic";
  readonly durationMs: number;
}

interface CreditCapitalPaymentAuditRejected {
  readonly operation: "query";
  readonly durationMs: number;
}

interface CreditCapitalContributionFailed {
  readonly operation: "create" | "update";
  readonly durationMs: number;
}

type PaymentReversalToPendingResult =
  | Readonly<{
      outcome: "completed" | "partially_completed";
      reversalPath: "already_pending" | "validated_payment";
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      durationMs: number;
    }>
  | Readonly<{
      outcome: "rejected";
      reasonCode: "schema_invalid" | "payment_not_found" | "credit_not_found";
      durationMs: number;
    }>
  | Readonly<{
      outcome: "failed";
      errorCode: "unknown";
      durationMs: number;
    }>;

type LateFeeOperation =
  | "history"
  | "deactivate"
  | "create"
  | "update"
  | "process"
  | "condone"
  | "list"
  | "bulk_condone";

type LateFeeReasonCode =
  | "schema_invalid"
  | "invalid_late_fee_amount"
  | "invalid_installment_count"
  | "overdue_count_mismatch"
  | "excluded_credit_state"
  | "amount_out_of_range"
  | "override_reason_missing"
  | "user_not_found"
  | "active_late_fee_not_found"
  | "credit_not_found"
  | "concurrent_run"
  | "overdue_installments_remain";

type CreditLateFeeResult =
  | Readonly<{ outcome: "completed"; operation: LateFeeOperation; durationMs: number }>
  | Readonly<{
      outcome: "completed";
      operation: "process" | "list" | "bulk_condone";
      durationMs: number;
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      skippedCount: number;
    }>
  | Readonly<{
      outcome: "skipped" | "rejected";
      operation: LateFeeOperation;
      durationMs: number;
      reasonCode: LateFeeReasonCode;
    }>
  | Readonly<{
      outcome: "degraded" | "failed";
      operation: LateFeeOperation;
      durationMs: number;
      errorCode: "persistence_failed" | "unknown";
    }>;

type DueDateOperation =
  | "batch_update"
  | "repair_missing_february"
  | "change_start_date"
  | "list_change_history"
  | "single_update"
  | "json_bulk_update";

type CreditDueDateResult =
  | Readonly<{ outcome: "completed"; operation: DueDateOperation; durationMs: number }>
  | Readonly<{
      outcome: "completed";
      operation: DueDateOperation;
      durationMs: number;
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      skippedCount: number;
    }>
  | Readonly<{
      outcome: "partially_completed";
      operation: DueDateOperation;
      durationMs: number;
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      skippedCount: number;
      reasonCode: "item_failures";
    }>
  | Readonly<{
      outcome: "skipped";
      operation: DueDateOperation;
      durationMs: number;
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      skippedCount: number;
      reasonCode: "missing_payment_reference";
    }>
  | Readonly<{
      outcome: "rejected";
      operation: DueDateOperation;
      durationMs: number;
      reasonCode: "schema_invalid" | "credit_not_found" | "installments_not_found" | "paid_installment_conflict";
    }>
  | Readonly<{
      outcome: "failed" | "partially_persisted";
      operation: DueDateOperation;
      durationMs: number;
      errorCode: "unknown";
    }>;

function emitAuditWithoutAffectingControlFlow(emit: () => void): void {
  try {
    emit();
  } catch {
    // Observability stays fail-closed: no fallback text is emitted, and the
    // audited endpoint keeps its historical response/control flow.
  }
}

export function emitCreditCapitalPaymentAuditCompleted(
  result: CreditCapitalPaymentAuditCompleted,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    const outcome = result.failedCount > 0 ? "partially_completed" : "completed";
    logger.emit("credit.capital_payment_audit", outcome, {
      audit_operation: "query",
      processed_count: result.processedCount,
      succeeded_count: result.succeededCount,
      failed_count: result.failedCount,
      duration_ms: result.durationMs,
    });
  });
}

export function emitCreditCapitalPaymentAuditDiagnosticCompleted(
  result: { readonly durationMs: number },
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    logger.emit("credit.capital_payment_audit", "diagnostic_completed", {
      audit_operation: "diagnostic",
      duration_ms: result.durationMs,
    });
  });
}

export function emitCreditCapitalPaymentAuditFailed(
  result: CreditCapitalPaymentAuditFailed,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    logger.emit("credit.capital_payment_audit", "failed", {
      audit_operation: result.operation,
      duration_ms: result.durationMs,
      error_code: "unknown",
    });
  });
}

export function emitCreditCapitalPaymentAuditRejected(
  result: CreditCapitalPaymentAuditRejected,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    logger.emit("credit.capital_payment_audit", "rejected", {
      audit_operation: result.operation,
      duration_ms: result.durationMs,
      reason_code: "schema_invalid",
    });
  });
}

export function emitCreditCapitalContributionFailed(
  result: CreditCapitalContributionFailed,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    logger.emit("credit.capital_contribution", "failed", {
      contribution_operation: result.operation,
      duration_ms: result.durationMs,
      error_code: "persistence_failed",
    });
  });
}

export function emitPaymentReversalToPending(
  result: PaymentReversalToPendingResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    if (result.outcome === "completed" || result.outcome === "partially_completed") {
      logger.emit("payment.reversal_to_pending", result.outcome, {
        reversal_path: result.reversalPath,
        processed_count: result.processedCount,
        succeeded_count: result.succeededCount,
        failed_count: result.failedCount,
        duration_ms: result.durationMs,
      });
      return;
    }
    if (result.outcome === "rejected") {
      logger.emit("payment.reversal_to_pending", "rejected", {
        duration_ms: result.durationMs,
        reason_code: result.reasonCode,
      });
      return;
    }
    if (result.outcome === "failed") {
      logger.emit("payment.reversal_to_pending", "failed", {
        duration_ms: result.durationMs,
        error_code: result.errorCode,
      });
    }
  });
}

export function emitCreditLateFee(
  result: CreditLateFeeResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    if (result.outcome === "completed") {
      const counts = "processedCount" in result
        ? {
            processed_count: result.processedCount,
            succeeded_count: result.succeededCount,
            failed_count: result.failedCount,
            skipped_count: result.skippedCount,
          }
        : {};
      logger.emit("credit.late_fee", "completed", {
        late_fee_operation: result.operation,
        duration_ms: result.durationMs,
        ...counts,
      });
      return;
    }
    if (result.outcome === "skipped" || result.outcome === "rejected") {
      logger.emit("credit.late_fee", result.outcome, {
        late_fee_operation: result.operation,
        duration_ms: result.durationMs,
        reason_code: result.reasonCode,
      });
      return;
    }
    if (result.outcome === "degraded" || result.outcome === "failed") {
      logger.emit("credit.late_fee", result.outcome, {
        late_fee_operation: result.operation,
        duration_ms: result.durationMs,
        error_code: result.errorCode,
      });
    }
  });
}

export function emitCreditDueDate(
  result: CreditDueDateResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    if (result.outcome === "skipped") {
      logger.emit("credit.due_date", "skipped", {
        due_date_operation: result.operation,
        duration_ms: result.durationMs,
        processed_count: result.processedCount,
        succeeded_count: result.succeededCount,
        failed_count: result.failedCount,
        skipped_count: result.skippedCount,
        reason_code: result.reasonCode,
      });
      return;
    }
    if (result.outcome === "partially_completed") {
      logger.emit("credit.due_date", "partially_completed", {
        due_date_operation: result.operation,
        duration_ms: result.durationMs,
        processed_count: result.processedCount,
        succeeded_count: result.succeededCount,
        failed_count: result.failedCount,
        skipped_count: result.skippedCount,
        reason_code: result.reasonCode,
      });
      return;
    }
    if (result.outcome === "completed") {
      if ("processedCount" in result) {
        logger.emit("credit.due_date", "completed", {
          due_date_operation: result.operation,
          duration_ms: result.durationMs,
          processed_count: result.processedCount,
          succeeded_count: result.succeededCount,
          failed_count: result.failedCount,
          skipped_count: result.skippedCount,
        });
        return;
      }
      logger.emit("credit.due_date", "completed", {
        due_date_operation: result.operation,
        duration_ms: result.durationMs,
      });
      return;
    }
    if (result.outcome === "rejected") {
      logger.emit("credit.due_date", "rejected", {
        due_date_operation: result.operation,
        duration_ms: result.durationMs,
        reason_code: result.reasonCode,
      });
      return;
    }
    logger.emit("credit.due_date", result.outcome, {
      due_date_operation: result.operation,
      duration_ms: result.durationMs,
      error_code: result.errorCode,
    });
  });
}

export function emitRecoveredDuplicatePendingInstallment(
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  logger.emit("payment.integrity_anomaly", "recovered", {
    anomaly_code: "duplicate_pending_installment",
    recovery_applied: true,
  });
}

export const carteraStructuredLogger = createCarteraStructuredLogger();