import { describe, expect, test } from "bun:test";
import { getGuatemalaPollingDates } from "./scheduler";

describe("getGuatemalaPollingDates", () => {
  test("returns current Guatemala date plus lookback dates", () => {
    expect(getGuatemalaPollingDates(new Date("2026-05-04T15:00:00.000Z"), 1)).toEqual(["2026-05-04", "2026-05-03"]);
  });
});
