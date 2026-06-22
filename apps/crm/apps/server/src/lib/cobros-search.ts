type CobrosSearchable = {
	vehiculoPlaca?: string | null;
};

function normalizePlate(value: string | null | undefined) {
	return (value ?? "").toLowerCase().replace(/[\s-]+/g, "");
}

export function filterCobrosSearchResults<T extends CobrosSearchable>(
	items: T[],
	searchTerm: string | null | undefined,
	offset = 0,
	limit?: number,
) {
	const query = normalizePlate(searchTerm);
	if (!query)
		return {
			total: items.length,
			items: limit === undefined ? items : items.slice(offset, offset + limit),
		};

	const filtered = items.filter((item) =>
		normalizePlate(item.vehiculoPlaca).includes(query),
	);

	return {
		total: filtered.length,
		items:
			limit === undefined ? filtered : filtered.slice(offset, offset + limit),
	};
}
