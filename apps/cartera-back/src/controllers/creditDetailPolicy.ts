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

export type StrictResetCreditInput = {
	creditId: number;
	montoIncobrable?: number;
	montoBoleta: number | string;
	url_boletas: string[];
	cuota: number;
	banco_id: number;
	numeroAutorizacion?: string;
};

export function isValidResetCreditInput(
	input: Record<string, unknown>,
): input is StrictResetCreditInput {
	const {
		creditId,
		montoIncobrable,
		montoBoleta,
		url_boletas,
		cuota,
		banco_id,
		numeroAutorizacion,
	} = input;
	const montoBoletaValido =
		(typeof montoBoleta === "number" &&
			Number.isFinite(montoBoleta) &&
			montoBoleta >= 0) ||
		(typeof montoBoleta === "string" &&
			/^\d+(?:\.\d+)?$/.test(montoBoleta.trim()) &&
			Number.isFinite(Number(montoBoleta.trim())));

	return (
		typeof creditId === "number" &&
		Number.isFinite(creditId) &&
		Number.isInteger(creditId) &&
		creditId > 0 &&
		montoBoletaValido &&
		Array.isArray(url_boletas) &&
		url_boletas.every((url) => typeof url === "string") &&
		typeof cuota === "number" &&
		Number.isFinite(cuota) &&
		Number.isInteger(cuota) &&
		cuota >= 0 &&
		typeof banco_id === "number" &&
		Number.isFinite(banco_id) &&
		Number.isInteger(banco_id) &&
		banco_id > 0 &&
		(montoIncobrable === undefined ||
			(typeof montoIncobrable === "number" &&
				Number.isFinite(montoIncobrable) &&
				montoIncobrable >= 0)) &&
		(numeroAutorizacion === undefined || typeof numeroAutorizacion === "string")
	);
}

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
	incobrableContinuationReady = false,
): boolean {
	return (
		status === "PENDIENTE_CANCELACION" ||
		(status === "INCOBRABLE" && incobrableContinuationReady)
	);
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
