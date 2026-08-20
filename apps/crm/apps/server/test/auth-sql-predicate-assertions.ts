export type QueryRecord = {
	text: string;
	params: unknown[];
};

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertBoundPredicate(
	query: QueryRecord,
	column: string,
	expectedValue: unknown,
	label: string,
) {
	const match = query.text.match(
		new RegExp(`${escapeRegExp(column)}\\s*=\\s*\\$(\\d+)`),
	);
	if (!match) {
		throw new Error(`${label} missing required predicate for ${column}`);
	}

	const placeholder = Number(match[1]);
	const parameterIndex = placeholder - 1;
	if (
		!Number.isInteger(parameterIndex) ||
		parameterIndex < 0 ||
		parameterIndex >= query.params.length
	) {
		throw new Error(`${label} references an invalid placeholder`);
	}

	if (!Object.is(query.params[parameterIndex], expectedValue)) {
		throw new Error(`${label} is bound to an unexpected value`);
	}
}

export function assertNoMalformedEquality(query: QueryRecord, label: string) {
	if (query.text.includes("( =")) {
		throw new Error(`${label} contains a malformed equality predicate`);
	}
}
