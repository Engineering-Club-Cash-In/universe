import { describe, expect, test } from "bun:test";
import { getGuatemalaPollingDates, startPaymentPolling } from "./scheduler";

describe("getGuatemalaPollingDates", () => {
  test("returns current Guatemala date plus lookback dates", () => {
    expect(getGuatemalaPollingDates(new Date("2026-05-04T15:00:00.000Z"), 1)).toEqual(["2026-05-04", "2026-05-03"]);
  });
});

test("polling emits a safe structured completion heartbeat", async () => {
  const logs: string[] = [];
  let scheduled = false;
  const stop = startPaymentPolling({
    intervalSeconds: 60,
    lookbackDays: 0,
    nexa: { getPaymentTokenStatement: async () => ({ transactions: [] }) },
    cartera: {} as never,
    transactions: { upsertReceived: async () => { throw new Error("unused"); } } as never,
    tokenUsers: {} as never,
    pollRuns: {
      runAsLeader: async (callback: () => Promise<unknown>) => callback(),
      run: async (_date: string, callback: () => Promise<unknown>) => callback(),
    } as never,
    scheduler: {
      setTimeout: () => { scheduled = true; return 1; },
      clearTimeout: () => undefined,
    },
    logInfo: (line) => logs.push(line),
  });
  for (let index = 0; index < 100 && !scheduled; index++) await Bun.sleep(1);
  stop();

  expect(logs.map((line) => JSON.parse(line))).toEqual([{
    scope: "nexa-polling",
    event: "cycle_completed",
    leader: true,
  }]);
  expect(logs.join(" ")).not.toContain("secret");
});
