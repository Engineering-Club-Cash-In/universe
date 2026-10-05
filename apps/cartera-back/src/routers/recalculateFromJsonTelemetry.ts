import {
  emitCreditScheduleRecalculation,
  type CarteraStructuredLogger,
  type CreditScheduleRecalculationResult,
} from "../utils/structuredLogger";

export function emitRouterFailure(
  operation: CreditScheduleRecalculationResult["operation"],
  logger?: CarteraStructuredLogger,
): void {
  emitCreditScheduleRecalculation({
    outcome: "failed",
    operation,
    processedCount: 1,
    succeededCount: 0,
    failedCount: 1,
    skippedCount: 0,
    manualActionRequired: false,
    durationMs: 0,
    errorCode: "unknown",
  }, logger);
}
