export function canEnterCancellationPaymentFlow(
	statusCredit: string | null | undefined,
): boolean {
	return statusCredit === "PENDIENTE_CANCELACION";
}
