import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { DEFAULT_PRESET, rangeForPreset } from "./range-preset-filter";

describe("rangeForPreset", () => {
	afterEach(() => setSystemTime());

	test("lastMonth returns the previous calendar month in Guatemala time", () => {
		setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
		const range = rangeForPreset("lastMonth");

		expect(range.from?.toISOString()).toBe("2026-06-01T06:00:00.000Z");
		expect(range.to?.toISOString()).toBe("2026-07-01T05:59:59.999Z");
	});

	test("keeps Este mes as the default preset", () => {
		expect(DEFAULT_PRESET).toBe("month");
	});
});
