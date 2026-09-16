export const IDENTITY_MATCH_THRESHOLD = 85;

export function normalizeNameTokens(name: string): string[] {
	return name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toUpperCase()
		.replace(/[^A-Z\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

/** Coeficiente de Dice sobre los tokens del nombre, expresado de 0 a 100. */
export function nameSimilarity(nameA: string, nameB: string): number {
	const tokensA = normalizeNameTokens(nameA);
	const tokensB = normalizeNameTokens(nameB);
	if (tokensA.length === 0 || tokensB.length === 0) return 0;

	const remaining = new Map<string, number>();
	for (const token of tokensB) {
		remaining.set(token, (remaining.get(token) ?? 0) + 1);
	}

	let matches = 0;
	for (const token of tokensA) {
		const count = remaining.get(token) ?? 0;
		if (count > 0) {
			matches++;
			remaining.set(token, count - 1);
		}
	}

	return (
		Math.round(((2 * matches) / (tokensA.length + tokensB.length)) * 10_000) /
		100
	);
}
