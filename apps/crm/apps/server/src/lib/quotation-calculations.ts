export function calculateMonthlyPayment(
	principal: number,
	monthlyRate: number,
	termMonths: number,
	insuranceCost: number,
	gpsCost: number,
): number {
	const rateWithVat = (monthlyRate / 100) * 1.12;
	if (rateWithVat === 0) return principal / termMonths;

	const factor = (1 + rateWithVat) ** termMonths;
	const baseMonthlyPayment =
		(principal * (rateWithVat * factor)) / (factor - 1);
	return Math.round((baseMonthlyPayment + insuranceCost + gpsCost) * 100) / 100;
}
