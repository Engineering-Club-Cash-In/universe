const GUATEMALA_TIME_ZONE = "America/Guatemala";

const formatMonthIndex = (monthIndex: number) => {
	const year = Math.floor(monthIndex / 12);
	const month = (monthIndex % 12) + 1;
	return `${year}-${String(month).padStart(2, "0")}`;
};

export function getInvestmentProjectionMonthBounds(now: Date): {
	defaultMonth: string;
	firstMonth: string;
	lastMonth: string;
} {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: GUATEMALA_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
	}).formatToParts(now);
	const year = Number(parts.find((part) => part.type === "year")?.value);
	const month = Number(parts.find((part) => part.type === "month")?.value);
	const firstMonthIndex = year * 12 + month;
	const firstMonth = formatMonthIndex(firstMonthIndex);

	return {
		defaultMonth: firstMonth,
		firstMonth,
		lastMonth: formatMonthIndex(firstMonthIndex + 11),
	};
}
