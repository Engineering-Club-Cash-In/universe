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

export function assertPagaloOtrosRequiresInstallment(
	otros: string | undefined,
	selectedNumbers: number[],
): void {
	if (otros && selectedNumbers.length === 0)
		throw new Error("Seleccione al menos una cuota para agregar Otros.");
}
