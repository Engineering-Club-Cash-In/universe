import type { NexaClient } from "../nexa/client";
import type { CarteraPaymentClient } from "../payments/cartera-client";
import { pollPaymentTokenDate } from "../payments/poller";
import type { DbPaymentTransactionRepository, DbTokenUserRepository, PollRunRepository } from "../db/repositories";

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
  nexa: NexaClient;
  cartera: CarteraPaymentClient;
  transactions: DbPaymentTransactionRepository;
  tokenUsers: DbTokenUserRepository;
  pollRuns: PollRunRepository;
}) {
  let running = false;

  const poll = async () => {
    if (running) return;
    running = true;
    try {
      for (const date of getGuatemalaPollingDates(new Date(), options.lookbackDays)) {
        await options.pollRuns.run(date, () => pollPaymentTokenDate({
          date,
          nexa: options.nexa,
          cartera: options.cartera,
          transactions: options.transactions,
          tokenUsers: options.tokenUsers,
        }));
      }
    } catch (error) {
      console.error("Nexa polling failed", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(poll, options.intervalSeconds * 1000);
  void poll();

  return () => clearInterval(timer);
}
