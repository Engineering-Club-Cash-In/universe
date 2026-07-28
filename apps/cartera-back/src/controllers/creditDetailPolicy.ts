export const CREDIT_DETAIL_STATUSES = [
	"ACTIVO",
	"PENDIENTE_CANCELACION",
	"MOROSO",
	"EN_CONVENIO",
	"INCOBRABLE",
	"CANCELADO",
] as const;

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

export const isScheduledCreditInstallment = (
	validationStatus: string | null | undefined,
): boolean => validationStatus !== "reset";

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
