import { describe, expect, test } from "bun:test";
import { getPaymentDateRangeFilter } from "./payment-date-range-filter";

describe("getPaymentDateRangeFilter", () => {
	test("accepts a payment date range before today", () => {
		const range = {
			from: new Date("2026-04-30T06:00:00.000Z"),
			to: new Date("2026-04-30T06:00:00.000Z"),
		};

		expect(getPaymentDateRangeFilter(range)).toEqual({
			dateRange: range,
			fechaDesde: "2026-04-30",
			fechaHasta: "2026-04-30",
			fechaError: null,
		});
	});
});
