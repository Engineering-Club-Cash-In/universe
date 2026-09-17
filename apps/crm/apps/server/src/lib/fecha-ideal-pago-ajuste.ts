import Big from "big.js";
import { toDateStrGT } from "./guatemala-month-window";

/**
 * Día que el sistema asigna por default cuando el analista NO elige un día
 * recomendado por IA: día≤20 del mes → 15, día>20 → 30. Mismo umbral que ya usan
 * getDefaultDiaPago() en InvestmentAssignmentSection.tsx y DynamicContractWizard.tsx
 * en el frontend, pero calculado server-side (no se confía en lo que mande el
 * cliente, mismo criterio que ya aplica la validación de diaPagoMensual).
 *
 * Debe capturarse en el momento de la asignación de inversión (50%), porque
 * depende de qué día es "hoy" en ese instante — no se puede recalcular después
 * sin cambiar su significado ("fecha prevista originalmente por el sistema").
 */
export function getDiaPagoOriginalSistema(
	fechaReferencia: Date = new Date(),
): 15 | 30 {
	const diaStr = toDateStrGT(fechaReferencia).split("-")[2];
	const dia = Number(diaStr);
	return dia <= 20 ? 15 : 30;
}

export interface CalcularAjusteFechaIdealParams {
	/** Día que el sistema hubiera asignado por default (capturado en el 50%). */
	diaPagoOriginalSistema: number;
	/** Día de pago realmente elegido por el analista (uno de los 3 días IA). */
	diaPagoMensualElegido: number;
	capital: number;
	/** Tasa de interés mensual del crédito, en porcentaje (0-100). */
	porcentajeInteres: number;
	membresiaMensual: number;
	seguroMensual: number;
	gpsMensual: number;
	/** Fecha desde la que se calcula el mes de la primera cuota. Default: hoy. */
	fechaReferencia?: Date;
}

export interface AjusteFechaIdealResult {
	diasDiferencia: number;
	diasDelMes: number;
	montoInteres: number;
	montoMembresia: number;
	montoServicios: number;
	montoTotal: number;
}

/**
 * Contexto calendario de la primera cuota usando la misma fecha de Guatemala
 * que generatePaymentDates en cartera-back.
 */
function getPrimeraCuotaCalendar(fechaReferencia: Date): {
	anio: number;
	mesIndex: number;
	diasDelMes: number;
} {
	const [anio, mes] = toDateStrGT(fechaReferencia).split("-").map(Number);
	return {
		anio,
		mesIndex: mes,
		diasDelMes: new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate(),
	};
}

/**
 * Calcula el ingreso adicional (interés, membresía, servicios = seguro + gps)
 * que hay que cobrar por elegir un día de pago IA que cae DESPUÉS del día que
 * el sistema hubiera asignado por default. El monto no incluye capital.
 *
 * Si el día IA es menor al original, se interpreta como el mes siguiente.
 * Solo cuando ambos días efectivos coinciden no aplica ajuste y retorna null.
 */
export function calcularAjusteFechaIdeal(
	params: CalcularAjusteFechaIdealParams,
): AjusteFechaIdealResult | null {
	const { anio, mesIndex, diasDelMes } = getPrimeraCuotaCalendar(
		params.fechaReferencia ?? new Date(),
	);

	const rollover = params.diaPagoMensualElegido < params.diaPagoOriginalSistema;
	const mesElegidoIndex = mesIndex + (rollover ? 1 : 0);
	const diasDelMesElegido = new Date(
		Date.UTC(anio, mesElegidoIndex + 1, 0),
	).getUTCDate();
	const fechaOriginal = Date.UTC(
		anio,
		mesIndex,
		Math.min(params.diaPagoOriginalSistema, diasDelMes),
	);
	const fechaElegida = Date.UTC(
		anio,
		mesElegidoIndex,
		Math.min(params.diaPagoMensualElegido, diasDelMesElegido),
	);
	const diasDiferencia = Math.round(
		(fechaElegida - fechaOriginal) / (24 * 60 * 60 * 1000),
	);

	if (diasDiferencia === 0) return null;

	const interesBaseMensual = new Big(params.capital)
		.times(params.porcentajeInteres)
		.div(100)
		.round(2);
	const ivaInteresMensual = interesBaseMensual.times(0.12).round(2);
	const prorratear = (montoMensual: Big): number =>
		Number(
			montoMensual.times(diasDiferencia).div(diasDelMes).round(2).toString(),
		);

	const montoInteres = prorratear(interesBaseMensual.plus(ivaInteresMensual));
	const montoMembresia = prorratear(new Big(params.membresiaMensual));
	const montoServicios = prorratear(
		new Big(params.seguroMensual).plus(params.gpsMensual),
	);

	return {
		diasDiferencia,
		diasDelMes,
		montoInteres,
		montoMembresia,
		montoServicios,
		montoTotal: Number(
			new Big(montoInteres)
				.plus(montoMembresia)
				.plus(montoServicios)
				.toString(),
		),
	};
}
