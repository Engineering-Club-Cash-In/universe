// Postgres rechaza U+0000 en text y jsonb. Algunos PDFs lo traen en sus
// metadatos (p. ej. productores de escáneres Canon terminan en \0).
export function stripNulCharacters<T>(value: T): T {
	if (typeof value === "string") return value.replaceAll("\u0000", "") as T;
	if (Array.isArray(value)) return value.map(stripNulCharacters) as T;
	if (
		value !== null &&
		typeof value === "object" &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value))
	) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				stripNulCharacters(key),
				stripNulCharacters(entry),
			]),
		) as T;
	}
	return value;
}
