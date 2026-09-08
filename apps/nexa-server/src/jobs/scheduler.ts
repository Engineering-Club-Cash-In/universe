import type { NexaClient } from "../nexa/client";
import type { DbPaymentTransactionRepository, DbTokenUserRepository, PollRunRepository } from "../db/repositories";
import type { CarteraPaymentClient } from "../payments/cartera-client";
import { pollPaymentTokenDate } from "../payments/poller";

export type Scheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const defaultScheduler: Scheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function getGuatemalaPollingDates(now: Date, lookbackDays: number) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dates: string[] = [];

  for (let index = 0; index <= lookbackDays; index++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - index);
    dates.push(formatter.format(date));
  }

  return dates;
}

export function startPaymentPolling(options: {
  intervalSeconds: number;
  lookbackDays: number;
  nexa: Pick<NexaClient, "getPaymentTokenStatement">;
  cartera: CarteraPaymentClient;
  transactions: DbPaymentTransactionRepository;
  tokenUsers: DbTokenUserRepository;
  pollRuns: PollRunRepository;
  scheduler?: Scheduler;
  logError?: (message: string) => void;
  logInfo?: (message: string) => void;
}) {
  const scheduler = options.scheduler ?? defaultScheduler;
  const logError = options.logError ?? console.error;
  const logInfo = options.logInfo ?? console.log;
  let stopped = false;
  let running = false;
  let timer: unknown;

  const poll = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await options.pollRuns.runAsLeader(async () => {
        for (const date of getGuatemalaPollingDates(new Date(), options.lookbackDays)) {
          await options.pollRuns.run(date, () => pollPaymentTokenDate({
            date,
            nexa: options.nexa,
            cartera: options.cartera,
            transactions: options.transactions,
            tokenUsers: options.tokenUsers,
          }));
        }
        return true;
      });
      logInfo(JSON.stringify({ scope: "nexa-polling", event: "cycle_completed", leader: result !== null }));
    } catch {
      logError("Nexa polling cycle failed");
    } finally {
      running = false;
      if (!stopped) timer = scheduler.setTimeout(() => void poll(), options.intervalSeconds * 1000);
    }
  };

  void poll();

  return () => {
    stopped = true;
    if (timer) scheduler.clearTimeout(timer);
  };
}
