export const CREDIT_DETAIL_STATUSES = [
	"ACTIVO",
	"PENDIENTE_CANCELACION",
	"MOROSO",
	"EN_CONVENIO",
	"INCOBRABLE",
	"CANCELADO",
] as const;

export const ORIGINAL_PRINCIPAL_PAYMENT_STATUSES = [
	"no_required",
	"validated",
	"capital_validated",
	"reset",
] as const;

export function isOriginalPrincipalPayment(payment: {
	validationStatus: string | null;
	pagado: boolean | null;
	paymentFalse: boolean | null;
}): boolean {
	if (payment.validationStatus === "no_required") {
		return payment.pagado === true && payment.paymentFalse !== true;
	}

	return (
		(payment.validationStatus === "validated" ||
			payment.validationStatus === "capital_validated" ||
			payment.validationStatus === "reset") &&
		payment.paymentFalse !== true
	);
}

export function isAmbiguousOriginalPrincipalPayment(payment: {
	validationStatus: string | null;
	pagado: boolean | null;
	paymentFalse: boolean | null;
}): boolean {
	return (
		(payment.validationStatus === "validated" ||
			payment.validationStatus === "capital_validated") &&
		payment.pagado === false &&
		payment.paymentFalse === true
	);
}

export function isCreditClosingPayment(payment: {
	validationStatus: string | null;
	registerBy: string | null;
}): boolean {
	return (
		payment.validationStatus === "reset" ||
		(payment.validationStatus === "validated" &&
			payment.registerBy === "system_reset")
	);
}

export function canViewCreditDetailByStatus(
	status: string | null | undefined,
): boolean {
	return (
		typeof status === "string" &&
		(CREDIT_DETAIL_STATUSES as readonly string[]).includes(status)
	);
}

export function canResetCreditByStatus(
	status: string | null | undefined,
): boolean {
	return status === "PENDIENTE_CANCELACION";
}

export function withActiveCancellation<T extends object, C>(
	detail: T,
	cancelacion: C | undefined,
	statusCredit: string | null | undefined,
) {
	if (!cancelacion && statusCredit !== "CANCELADO") return detail;

	return {
		...detail,
		...(cancelacion ? { cancelacion } : {}),
		flujo: "CANCELADO" as const,
	};
}
