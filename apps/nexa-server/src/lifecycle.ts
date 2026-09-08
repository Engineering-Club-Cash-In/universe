import type { AppConfig } from "./config";
import type { AppDependencies } from "./dependencies";
import { defaultScheduler, startPaymentPolling, type Scheduler } from "./jobs/scheduler";
import { runApplicationWorkerOnce } from "./payments/application-worker";
import { runReviewWorkerOnce } from "./payments/review-worker";

export type LifecycleScheduler = Scheduler;

export function startPaymentLifecycle(
  config: AppConfig,
  deps: AppDependencies,
  options: { scheduler?: Scheduler; logError?: (message: string) => void } = {},
) {
  if (config.deploymentMode !== "qa_real_payments") return () => {};

  const scheduler = options.scheduler ?? defaultScheduler;
  const logError = options.logError ?? console.error;
  const workerOptions = {
    leaseSeconds: config.workerLeaseSeconds,
    maxAttempts: config.workerMaxAttempts,
    backoffSeconds: config.workerBackoffSeconds,
    maxBackoffSeconds: config.workerMaxBackoffSeconds,
  };
  const stops = [
    startPaymentPolling({
      intervalSeconds: config.nexaPollIntervalSeconds,
      lookbackDays: config.nexaPollLookbackDays,
      nexa: deps.nexa,
      cartera: deps.cartera,
      transactions: deps.transactions,
      tokenUsers: deps.tokenUsers,
      pollRuns: deps.pollRuns,
      scheduler,
      logError,
    }),
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
