import { describe, expect, test } from "bun:test";
import { getGuatemalaMonthWindow } from "./guatemala-month-window";

describe("getGuatemalaMonthWindow", () => {
	test("returns UTC bounds for the start and end of an April window in Guatemala", () => {
		const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(2026, 4);

		expect(startOfMonth.toISOString()).toBe("2026-04-01T06:00:00.000Z");
		expect(endOfMonth.toISOString()).toBe("2026-05-01T06:00:00.000Z");
	});

	test("handles year boundaries", () => {
		const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(2026, 12);

		expect(startOfMonth.toISOString()).toBe("2026-12-01T06:00:00.000Z");
		expect(endOfMonth.toISOString()).toBe("2027-01-01T06:00:00.000Z");
	});
});
