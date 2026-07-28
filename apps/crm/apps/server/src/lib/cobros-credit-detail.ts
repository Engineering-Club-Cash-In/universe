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

type CreditDetailRow = {
	abono_capital?: string | null;
	cuota?: string | null;
	validationStatus?: string | null;
};

function toCents(amount: string | null | undefined): number {
	const [whole = "0", fraction = ""] = (amount ?? "0").split(".");
	return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function fromCents(cents: number): string {
	return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function resolveCreditContractSummary(
	statusCredit: string,
	paidRows: readonly CreditDetailRow[] | null | undefined,
	fallbackPrincipal: string,
	fallbackInstallment: string,
	authoritativeSummary?: {
		originalPrincipal?: string | null;
		installment?: string | null;
	},
): { principal: string; installment: string } {
	if (statusCredit !== "CANCELADO") {
		return { principal: fallbackPrincipal, installment: fallbackInstallment };
	}

	const rows = paidRows ?? [];
	const principalCents = rows.reduce(
		(total, row) => total + toCents(row.abono_capital),
		0,
	);
	const resetInstallment = rows.find(
		(row) => row.validationStatus === "reset" && row.cuota != null,
	)?.cuota;
	const installment =
		resetInstallment ?? rows.find((row) => row.cuota != null)?.cuota;

	return {
		principal:
			(authoritativeSummary?.originalPrincipal &&
			toCents(authoritativeSummary.originalPrincipal) > 0
				? authoritativeSummary.originalPrincipal
				: undefined) ||
			(principalCents > 0 ? fromCents(principalCents) : fallbackPrincipal),
		installment:
			(authoritativeSummary?.installment &&
			toCents(authoritativeSummary.installment) > 0
				? authoritativeSummary.installment
				: undefined) ||
			installment ||
			fallbackInstallment,
	};
}

export function countRemainingInstallments(
	statusCredit: string,
	totalInstallments: number,
	paidRows: readonly { validationStatus?: string | null }[] | null | undefined,
	initialInstallmentPaid: boolean,
): number {
	if (statusCredit === "CANCELADO") return 0;
	return Math.max(
		0,
		totalInstallments -
			countScheduledPaidInstallments(paidRows) +
			(initialInstallmentPaid ? 1 : 0),
	);
}
