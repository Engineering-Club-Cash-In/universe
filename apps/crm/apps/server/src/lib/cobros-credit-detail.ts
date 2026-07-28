export function countScheduledPaidInstallments(
	rows: readonly { validationStatus?: string | null }[] | null | undefined,
): number {
	return rows?.filter((row) => row.validationStatus !== "reset").length ?? 0;
}
