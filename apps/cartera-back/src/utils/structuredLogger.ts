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

export function emitRecoveredDuplicatePendingInstallment(
  logger: CarteraStructuredLogger = carteraStructuredLogger,
): void {
  logger.emit("payment.integrity_anomaly", "recovered", {
    anomaly_code: "duplicate_pending_installment",
    recovery_applied: true,
  });
}

export const carteraStructuredLogger = createCarteraStructuredLogger();