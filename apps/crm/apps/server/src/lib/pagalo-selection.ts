export function assertPagaloInstallmentSelection(
	selectedNumbers: number[],
	availableNumbers: number[],
): void {
	const expected = [...availableNumbers]
		.sort((a, b) => a - b)
		.slice(0, selectedNumbers.length);
	const actual = [...selectedNumbers].sort((a, b) => a - b);
	if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
		throw new Error("Las cuotas Págalo deben formar un prefijo consecutivo desde la más antigua.");
	}
}
