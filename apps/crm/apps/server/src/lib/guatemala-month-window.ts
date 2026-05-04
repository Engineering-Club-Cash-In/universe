const GUATEMALA_UTC_OFFSET_HOURS = 6;

export function getGuatemalaMonthWindow(year: number, month: number) {
	return {
		startOfMonth: new Date(
			Date.UTC(year, month - 1, 1, GUATEMALA_UTC_OFFSET_HOURS),
		),
		endOfMonth: new Date(
			Date.UTC(year, month, 1, GUATEMALA_UTC_OFFSET_HOURS),
		),
	};
}
