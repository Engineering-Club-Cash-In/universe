export function countScheduledPaidInstallments(
	rows: readonly { validationStatus?: string | null }[] | null | undefined,
): number {
	return rows?.filter((row) => row.validationStatus !== "reset").length ?? 0;
}

export function resolveInstallmentAmount(
	rowAmount: string | null | undefined,
	currentCreditAmount: string,
): string {
	return rowAmount ?? currentCreditAmount;
}
