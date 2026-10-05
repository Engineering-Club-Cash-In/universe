export const INVESTMENT_REPORT_PAGE_SIZE = 25;

export type TablePage<Row> = {
	rows: Row[];
	page: number;
	totalPages: number;
	from: number;
	to: number;
	total: number;
};

export function getTablePage<Row>(
	rows: readonly Row[],
	requestedPage: number,
	pageSize = INVESTMENT_REPORT_PAGE_SIZE,
): TablePage<Row> {
	const safePageSize = Math.max(1, Math.trunc(pageSize));
	const total = rows.length;
	const totalPages = Math.max(1, Math.ceil(total / safePageSize));
	const normalizedPage = Number.isFinite(requestedPage)
		? Math.trunc(requestedPage)
		: 1;
	const page = Math.min(Math.max(normalizedPage, 1), totalPages);
	const startIndex = (page - 1) * safePageSize;
	const pageRows = rows.slice(startIndex, startIndex + safePageSize);

	return {
		rows: pageRows,
		page,
		totalPages,
		from: total === 0 ? 0 : startIndex + 1,
		to: total === 0 ? 0 : startIndex + pageRows.length,
		total,
	};
}
