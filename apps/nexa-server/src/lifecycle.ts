import type { AppConfig } from "./config";
import type { AppDependencies } from "./dependencies";
import { defaultScheduler, type Scheduler } from "./jobs/scheduler";
import { runApplicationWorkerOnce } from "./payments/application-worker";
import { runReviewWorkerOnce } from "./payments/review-worker";

export type LifecycleScheduler = Scheduler;

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
  const stops = [
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
      const staleBefore = new Date(now.getTime() - config.workerIntervalSeconds * 1_000);
      const alerts = await deps.transactions.listReconciliationAlerts(now, staleBefore);
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
      return false;
    }, scheduler, logError),
  ];

  return () => stops.forEach((stop) => stop());
}

function startWorkerLoop(
  name: string,
  intervalSeconds: number,
  runOnce: () => Promise<boolean>,
  scheduler: Scheduler,
  logError: (message: string) => void,
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
  void cycle();

  return () => {
    stopped = true;
    if (timer) scheduler.clearTimeout(timer);
  };
}
