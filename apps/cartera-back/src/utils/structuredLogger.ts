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
export type ScheduledJobName = typeof carteraCatalog.fields.job_name.values[number];

export type JobExecutionResult = Readonly<{
  outcome: "completed";
  jobName: ScheduledJobName;
  durationMs: number;
}> | Readonly<{
  outcome: "failed";
  jobName: ScheduledJobName;
  durationMs: number;
  errorCode: "unknown";
}>;

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
      outcome: "local_state_inconsistent";
      reversalPath: "already_pending" | "validated_payment";
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      errorCode: "persistence_failed";
      durationMs: number;
    }>
  | Readonly<{
      outcome: "rejected";
      reasonCode: "schema_invalid" | "payment_not_found" | "credit_not_found" | "state_conflict";
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

type PaymentReversalState = "applied" | "pending" | "unknown";

type JsonRecalculationOperation =
  | "recalculate"
  | "process_pools"
  | "delete_credits"
  | "update_investor_installments";

export type CreditScheduleRecalculationResult = Readonly<{
  outcome: "completed";
  operation: JsonRecalculationOperation;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  manualActionRequired: false;
  durationMs: number;
}> | Readonly<{
  outcome: "partially_completed" | "rejected";
  operation: JsonRecalculationOperation;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  manualActionRequired: boolean;
  durationMs: number;
  reasonCode: "item_failures" | "no_actionable_items";
}> | Readonly<{
  outcome: "partially_persisted" | "failed";
  operation: JsonRecalculationOperation;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  manualActionRequired: boolean;
  durationMs: number;
  errorCode: "persistence_failed" | "unknown";
}>;

export type SifcoPaymentMigrationResult = Readonly<{
  outcome: "completed";
  operation: "adjust_schedule" | "import_payments";
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
}> | Readonly<{
  outcome: "partially_completed";
  operation: "import_payments";
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  reasonCode: "item_failures";
}>;

export type PaymentReversalResult =
  | Readonly<{
      outcome: "completed";
      previousPaymentState: Exclude<PaymentReversalState, "unknown">;
      creditUpdated: boolean;
      investmentsReversed: boolean;
      manualActionRequired: false;
      durationMs: number;
    }>
  | Readonly<{
      outcome: "partially_completed";
      previousPaymentState: PaymentReversalState;
      creditUpdated: boolean;
      investmentsReversed: boolean;
      manualActionRequired: true;
      durationMs: number;
      reasonCode: "manual_reconciliation_required" | "local_state_inconsistent";
    }>
  | Readonly<{
      outcome: "rejected";
      previousPaymentState: PaymentReversalState;
      creditUpdated: boolean;
      investmentsReversed: boolean;
      manualActionRequired: boolean;
      durationMs: number;
      reasonCode: "schema_invalid" | "payment_not_found" | "credit_not_found" | "state_conflict" | "user_not_found" | "manual_reconciliation_required";
    }>
  | Readonly<{
      outcome: "failed";
      previousPaymentState: PaymentReversalState;
      creditUpdated: boolean;
      investmentsReversed: boolean;
      manualActionRequired: boolean;
      durationMs: number;
      errorCode: "persistence_failed" | "unknown";
    }>;

export type InvoiceVoidingResult =
  | Readonly<{
      outcome: "completed";
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      manualActionRequired: false;
      durationMs: number;
    }>
  | Readonly<{
      outcome: "provider_rejected";
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      manualActionRequired: true;
      durationMs: number;
      reasonCode: "provider_rejected";
    }>
  | Readonly<{
      outcome: "local_state_inconsistent";
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      manualActionRequired: true;
      durationMs: number;
      errorCode: "persistence_failed";
    }>
  | Readonly<{
      outcome: "failed";
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      manualActionRequired: boolean;
      durationMs: number;
      errorCode: "timeout" | "provider_unavailable" | "unknown";
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

export function emitCreditCapitalContributionCompleted(
  result: CreditCapitalContributionFailed,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    logger.emit("credit.capital_contribution", "completed", {
      contribution_operation: result.operation,
      duration_ms: result.durationMs,
    });
  });
}

export function emitCreditCapitalContributionRejected(
  result: CreditCapitalContributionFailed,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    logger.emit("credit.capital_contribution", "rejected", {
      contribution_operation: result.operation,
      duration_ms: result.durationMs,
      reason_code: "capital_contribution_not_found",
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
    if (result.outcome === "local_state_inconsistent") {
      logger.emit("payment.reversal_to_pending", "local_state_inconsistent", {
        reversal_path: result.reversalPath,
        processed_count: result.processedCount,
        succeeded_count: result.succeededCount,
        failed_count: result.failedCount,
        duration_ms: result.durationMs,
        error_code: result.errorCode,
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

export function emitPaymentReversal(
  result: PaymentReversalResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    const common = {
      previous_payment_state: result.previousPaymentState,
      credit_updated: result.creditUpdated,
      investments_reversed: result.investmentsReversed,
      manual_action_required: result.manualActionRequired,
      duration_ms: result.durationMs,
    };
    if (result.outcome === "completed") {
      logger.emit("payment.reversal", "completed", common);
      return;
    }
    if (result.outcome === "partially_completed" || result.outcome === "rejected") {
      logger.emit("payment.reversal", result.outcome, {
        ...common,
        reason_code: result.reasonCode,
      });
      return;
    }
    logger.emit("payment.reversal", "failed", {
      ...common,
      error_code: result.errorCode,
    });
  });
}

export function emitInvoiceVoiding(
  result: InvoiceVoidingResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    const common = {
      voiding_mode: "payment_reversal" as const,
      provider: "cofidi_sat" as const,
      processed_count: result.processedCount,
      succeeded_count: result.succeededCount,
      failed_count: result.failedCount,
      manual_action_required: result.manualActionRequired,
      duration_ms: result.durationMs,
    };
    if (result.outcome === "completed") {
      logger.emit("invoice.voiding", "completed", common);
      return;
    }
    if (result.outcome === "provider_rejected") {
      logger.emit("invoice.voiding", "provider_rejected", {
        ...common,
        reason_code: result.reasonCode,
      });
      return;
    }
    logger.emit("invoice.voiding", result.outcome, {
      ...common,
      error_code: result.errorCode,
    });
  });
}

export function emitCreditScheduleRecalculation(
  result: CreditScheduleRecalculationResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    const common = {
      recalculation_strategy: "from_json" as const,
      recalculation_operation: result.operation,
      processed_count: result.processedCount,
      succeeded_count: result.succeededCount,
      failed_count: result.failedCount,
      skipped_count: result.skippedCount,
      manual_action_required: result.manualActionRequired,
      duration_ms: result.durationMs,
    };
    if (result.outcome === "completed") {
      logger.emit("credit.schedule_recalculation", "completed", common);
      return;
    }
    if (result.outcome === "partially_completed" || result.outcome === "rejected") {
      logger.emit("credit.schedule_recalculation", result.outcome, {
        ...common,
        reason_code: result.reasonCode,
      });
      return;
    }
    if ("errorCode" in result) {
      logger.emit("credit.schedule_recalculation", result.outcome, {
        ...common,
        error_code: result.errorCode,
      });
    }
  });
}

export function emitSifcoPaymentMigration(
  result: SifcoPaymentMigrationResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    const common = {
      migration_operation: result.operation,
      processed_count: result.processedCount,
      succeeded_count: result.succeededCount,
      failed_count: result.failedCount,
      skipped_count: result.skippedCount,
      duration_ms: result.durationMs,
    };
    if (result.outcome === "completed") {
      logger.emit("payment.sifco_migration", "completed", common);
      return;
    }
    logger.emit("payment.sifco_migration", "partially_completed", {
      ...common,
      reason_code: result.reasonCode,
    });
  });
}

export function emitJobExecution(
  result: JobExecutionResult,
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  emitAuditWithoutAffectingControlFlow(() => {
    if (result.outcome === "completed") {
      logger.emit("job.execution", "completed", {
        job_name: result.jobName,
        duration_ms: result.durationMs,
      });
      return;
    }
    logger.emit("job.execution", "failed", {
      job_name: result.jobName,
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