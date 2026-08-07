import Big from "big.js";

export const RESET_CREDIT_ERRORS = {
	CREDITO_NO_ENCONTRADO: "Crédito no encontrado.",
	ESTADO_INVALIDO:
		"El crédito no está pendiente de cancelación ni listo para continuar como incobrable.",
	CIERRE_PREVIO: "El crédito ya tiene un pago de cierre system_reset.",
} as const;

/**
 * Normaliza un monto en quetzales a 2 decimales (half-up, igual que el cast a
 * numeric(18,2) de Postgres). Los montos que llegan del front vienen de
 * aritmética float de JS (p.ej. 106488.77 - 90000 = 16488.770000000004) y las
 * columnas de dinero redondean a centavos: comparar o persistir sin normalizar
 * garantiza descuadres de polvo de float.
 */
export function normalizarMontoQ(monto: number | string): string {
	return new Big(monto).round(2).toFixed(2);
}

/**
 * Un crédito INCOBRABLE puede continuar su cierre (insoluto) solo si el monto
 * incobrable solicitado coincide al centavo con el capital castigado del
 * crédito y con lo registrado en bad_debts, y todavía no existe pago de cierre.
 * La comparación es sobre montos normalizados: el monto del front trae polvo
 * de float y los de la DB ya están redondeados a 2 decimales.
 */
export function isIncobrableContinuationReady({
	montoIncobrable,
	capitalCredito,
	montoIncobrableRegistrado,
	tienePagoCierre,
}: {
	montoIncobrable: number | undefined;
	capitalCredito: string | number | null | undefined;
	montoIncobrableRegistrado: string | number | null | undefined;
	tienePagoCierre: boolean;
}): boolean {
	if (
		montoIncobrable === undefined ||
		!Number.isFinite(montoIncobrable) ||
		montoIncobrableRegistrado === null ||
		montoIncobrableRegistrado === undefined ||
		tienePagoCierre
	) {
		return false;
	}

	try {
		const monto = new Big(normalizarMontoQ(montoIncobrable));
		return (
			monto.gt(0) &&
			monto.eq(normalizarMontoQ(capitalCredito ?? 0)) &&
			monto.eq(normalizarMontoQ(montoIncobrableRegistrado))
		);
	} catch {
		return false;
	}
}

/**
 * Errores de negocio de resetCredit → status HTTP + mensaje que el front puede
 * mostrar tal cual. Todo lo demás (fallas internas) se queda en el 500
 * genérico para no filtrar detalles de infraestructura en el toast.
 */
export function mapResetCreditError(error: unknown): {
	status: 404 | 409 | 500;
	message: string;
} {
	const message = error instanceof Error ? error.message : String(error);
	if (message === RESET_CREDIT_ERRORS.CREDITO_NO_ENCONTRADO) {
		return { status: 404, message };
	}
	if (
		message === RESET_CREDIT_ERRORS.ESTADO_INVALIDO ||
		message === RESET_CREDIT_ERRORS.CIERRE_PREVIO
	) {
		return { status: 409, message };
	}
	return { status: 500, message: "Error reiniciando el crédito" };
}

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
