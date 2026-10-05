/**
 * Mapeo de los cheques de una oportunidad a los campos de la
 * "Carta de Emisión de Cheques" ({cuenta}/{valor} y {cuenta2}/{valor2}).
 *
 * La tabla del .docx tiene DOS filas fijas, así que solo caben dos cheques.
 * La columna se titula "Transferencia a cuenta y/o Beneficiario": por eso la
 * celda lleva el beneficiario y, cuando existe, el número de cuenta.
 */
import { formatMoneyNumber } from "./contract-utils";

/** Filas disponibles en la plantilla. */
export const MAX_DISBURSEMENT_ROWS = 2;

/** Única moneda que soporta la plantilla: imprime "Q." como texto fijo. */
const SUPPORTED_CURRENCY = "GTQ";

/** Subconjunto de `creditChecks` que necesita el mapeo. */
export interface DisbursementCheck {
	id: string;
	beneficiary: string;
	/** `decimal` de Postgres: llega como string. */
	amount: string;
	currency: string;
	checkDate: Date | string;
	createdAt: Date | string;
}

export interface DisbursementRow {
	cuenta: string;
	valor: string;
}

export interface DisbursementMapping {
	filas: DisbursementRow[];
	/** Cheques válidos que no cupieron en la plantilla. */
	sobrantes: number;
	/** Cheques descartados por no estar en quetzales. */
	omitidosPorMoneda: number;
}

function tiempo(valor: Date | string): number {
	const fecha = valor instanceof Date ? valor : new Date(valor);
	const ms = fecha.getTime();
	return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Mismo orden que ve jurídico en Detalle de la Oportunidad → Crédito →
 * Emisión de Cheques, para que puedan contrastar de un vistazo: `cuenta` y
 * `cuenta2` son posicionales.
 *
 * Esa pantalla ordena solo por `checkDate` descendente, lo que es ambiguo
 * cuando dos cheques comparten fecha (el caso normal: se registran el mismo
 * día). El desempate por `createdAt` y luego `id` lo vuelve determinista sin
 * cambiar lo que la pantalla muestra hoy.
 */
function porOrdenDePantalla(
	a: DisbursementCheck,
	b: DisbursementCheck,
): number {
	const porFecha = tiempo(b.checkDate) - tiempo(a.checkDate);
	if (porFecha !== 0) return porFecha;

	const porCreacion = tiempo(b.createdAt) - tiempo(a.createdAt);
	if (porCreacion !== 0) return porCreacion;

	return a.id.localeCompare(b.id);
}

/**
 * Construye la celda "Transferencia a cuenta y/o Beneficiario".
 *
 * Solo el nombre del beneficiario: así lo escribió jurídico en los contratos
 * ya generados ("Cube Investments, S.A.", "JUNIOR MANUEL GIL DUARTE"), sin
 * el número de cuenta.
 */
function construirCuenta(check: DisbursementCheck): string {
	return check.beneficiary.trim();
}

/**
 * Convierte los cheques de una oportunidad en las filas de la carta.
 *
 * Nunca rellena una fila sobrante con "-" ni "N/A": la plantilla imprime
 * "Q. {valor}", y un valor vacío deja la celda limpia en vez de un "Q." suelto.
 */
export function mapChecksToDisbursementRows(
	checks: DisbursementCheck[],
): DisbursementMapping {
	const conMontoValido = checks.filter(
		(check) =>
			check.beneficiary?.trim() && Number.isFinite(Number(check.amount)),
	);

	const enQuetzales = conMontoValido.filter(
		(check) => (check.currency ?? SUPPORTED_CURRENCY) === SUPPORTED_CURRENCY,
	);

	const filas = [...enQuetzales]
		.sort(porOrdenDePantalla)
		.slice(0, MAX_DISBURSEMENT_ROWS)
		.map((check) => ({
			cuenta: construirCuenta(check),
			// Sin "Q.": la plantilla ya lo imprime antes del placeholder.
			valor: formatMoneyNumber(Number(check.amount)),
		}));

	return {
		filas,
		sobrantes: Math.max(0, enQuetzales.length - MAX_DISBURSEMENT_ROWS),
		omitidosPorMoneda: conMontoValido.length - enQuetzales.length,
	};
}
