import type { DateRange } from "react-day-picker";

export function getPaymentDateRangeFilter(range: DateRange | undefined) {
	if (!range) {
		return {
			dateRange: undefined,
			fechaDesde: undefined,
			fechaHasta: undefined,
			fechaError: null,
		};
	}

	return {
		dateRange: range,
		fechaDesde: range.from ? range.from.toISOString().slice(0, 10) : undefined,
		fechaHasta: range.to ? range.to.toISOString().slice(0, 10) : undefined,
		fechaError: null,
	};
}
