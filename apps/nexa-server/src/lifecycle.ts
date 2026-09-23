import type { AppConfig } from "./config";
import type { AppDependencies } from "./dependencies";
import { defaultScheduler, type Scheduler } from "./jobs/scheduler";
import { runApplicationWorkerOnce } from "./payments/application-worker";
import { runReviewWorkerOnce } from "./payments/review-worker";
import { runStatementEnrichmentOnce } from "./payments/statement-enrichment";

export type LifecycleScheduler = Scheduler;

const MANUAL_REVIEW_ALERT_INTERVAL_SECONDS = 300;

export function startPaymentLifecycle(
  config: AppConfig,
  deps: AppDependencies,
  options: { scheduler?: Scheduler; logError?: (message: string) => void; logInfo?: (message: string) => void } = {},
) {
  if (config.deploymentMode !== "qa_real_payments") return () => {};

  const scheduler = options.scheduler ?? defaultScheduler;
  const logError = options.logError ?? console.error;
  const logInfo = options.logInfo ?? console.log;
  const workerOptions = {
    leaseSeconds: config.workerLeaseSeconds,
    maxAttempts: config.workerMaxAttempts,
    backoffSeconds: config.workerBackoffSeconds,
    maxBackoffSeconds: config.workerMaxBackoffSeconds,
  };
  type ReconciliationAlert =
    | Awaited<ReturnType<typeof deps.transactions.listReconciliationAlerts>>[number]
    | Awaited<ReturnType<typeof deps.transactions.listManualReviewAlerts>>[number];
  const logAlerts = (alerts: ReconciliationAlert[]) => {
    for (const alert of alerts) {
      logInfo(JSON.stringify({
        scope: "nexa-reconciliation",
        event: "reconciliation_alert",
        alertType: alert.alertType,
        reference: alert.reference,
        processingStatus: alert.processingStatus,
        attemptCount: alert.attemptCount,
        reviewAttemptCount: alert.reviewAttemptCount,
        failureReason: alert.failureReason,
        updatedAt: alert.updatedAt.toISOString(),
        nextAttemptAt: alert.nextAttemptAt?.toISOString() ?? null,
        reviewNextAttemptAt: alert.reviewNextAttemptAt?.toISOString() ?? null,
      }));
    }
  };
  const stops = [
    startWorkerLoop("Statement enrichment", 30, async () => {
      await runStatementEnrichmentOnce({ repository: deps.transactions, nexa: deps.nexa });
      return false;
    }, scheduler, logError),
    startWorkerLoop("Application worker", config.workerIntervalSeconds, () => runApplicationWorkerOnce({
      repository: deps.transactions,
      cartera: deps.cartera,
      ...workerOptions,
    }), scheduler, logError),
    startWorkerLoop("Review worker", config.workerIntervalSeconds, () => runReviewWorkerOnce({
      repository: deps.reviews,
      nexa: deps.nexa,
      ...workerOptions,
    }), scheduler, logError),
    startWorkerLoop("Reconciliation scanner", config.workerIntervalSeconds, async () => {
      const now = new Date();
      logAlerts(await deps.transactions.listReconciliationAlerts(
        now,
        new Date(now.getTime() - config.workerIntervalSeconds * 1_000),
      ));
      return false;
    }, scheduler, logError),
    startWorkerLoop("Manual review scanner", MANUAL_REVIEW_ALERT_INTERVAL_SECONDS, async () => {
      const now = new Date();
      logAlerts(await deps.transactions.listManualReviewAlerts(
        new Date(now.getTime() - MANUAL_REVIEW_ALERT_INTERVAL_SECONDS * 1_000),
      ));
      return false;
    }, scheduler, logError, true),
  ];

  return () => stops.forEach((stop) => stop());
}

function startWorkerLoop(
  name: string,
  intervalSeconds: number,
  runOnce: () => Promise<boolean>,
  scheduler: Scheduler,
  logError: (message: string) => void,
  delayFirstRun = false,
) {
  let stopped = false;
  let timer: unknown;
  const cycle = async () => {
    if (stopped) return;
    try {
      while (!stopped && await runOnce()) {}
    } catch {
      logError(`${name} cycle failed`);
    }
    if (!stopped) timer = scheduler.setTimeout(() => void cycle(), intervalSeconds * 1000);
  };
  if (delayFirstRun) timer = scheduler.setTimeout(() => void cycle(), intervalSeconds * 1000);
  else void cycle();

  return () => {
    stopped = true;
    if (timer) scheduler.clearTimeout(timer);
  };
}
