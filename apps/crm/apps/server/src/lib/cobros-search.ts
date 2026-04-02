type CobrosSearchable = {
	clienteNombre?: string | null;
	vehiculoPlaca?: string | null;
};

export function normalizeCobrosSearchValue(value: string | null | undefined) {
	return (value ?? "").toLowerCase().replace(/[\s-]+/g, "").trim();
}

export function matchesCobrosSearch(
	item: CobrosSearchable,
	searchTerm: string | null | undefined,
) {
	const rawQuery = (searchTerm ?? "").trim().toLowerCase();
	if (!rawQuery) return true;

	const normalizedQuery = normalizeCobrosSearchValue(searchTerm);
	const customerName = (item.clienteNombre ?? "").toLowerCase();
	const vehiclePlate = normalizeCobrosSearchValue(item.vehiculoPlaca);

	return (
		customerName.includes(rawQuery) ||
		(normalizedQuery.length > 0 && vehiclePlate.includes(normalizedQuery))
	);
}

export function filterCobrosSearchResults<T extends CobrosSearchable>(
	items: T[],
	searchTerm: string | null | undefined,
	offset = 0,
	limit?: number,
) {
	const filtered = items.filter((item) => matchesCobrosSearch(item, searchTerm));

	return {
		total: filtered.length,
		items:
			limit === undefined ? filtered : filtered.slice(offset, offset + limit),
	};
}
