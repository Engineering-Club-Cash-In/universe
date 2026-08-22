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

export function emitRecoveredDuplicatePendingInstallment(
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  logger.emit("payment.integrity_anomaly", "recovered", {
    anomaly_code: "duplicate_pending_installment",
    recovery_applied: true,
  });
}

export const carteraStructuredLogger = createCarteraStructuredLogger();