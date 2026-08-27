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
	/** Interés proporcional bruto: interés base mensual más su IVA del 12%. */
	montoInteres: number;
	montoMembresia: number;
	montoServicios: number;
	montoTotal: number;
}

/**
 * Días del mes de la primera cuota, mismo cálculo que generatePaymentDates en
 * cartera-back (createCredit.ts) — a propósito hora local del server, no GT,
 * para no desincronizarse del mes que cartera-back realmente agenda.
 */
function getDiasDelMesPrimeraCuota(fechaReferencia: Date): number {
	const anio = fechaReferencia.getFullYear();
	const mesBase = fechaReferencia.getMonth() + 1; // "mes siguiente", 0-based
	return new Date(anio, mesBase + 1, 0).getDate();
}

/**
 * Calcula el ingreso adicional (interés, membresía, servicios = seguro + gps)
 * que hay que cobrar por elegir un día de pago IA que cae DESPUÉS del día que
 * el sistema hubiera asignado por default. El monto no incluye capital.
 *
 * Si la fecha IA no cae después del día original (diferencia ≤ 0), no aplica
 * ningún ajuste y retorna null — no se debe generar fila de auditoría en ese caso.
 */
export function calcularAjusteFechaIdeal(
	params: CalcularAjusteFechaIdealParams,
): AjusteFechaIdealResult | null {
	const diasDelMes = getDiasDelMesPrimeraCuota(
		params.fechaReferencia ?? new Date(),
	);

	// Clamp de fin de mes: el pago real cae en el último día del mes si el día
	// elegido (29/30/31) no existe ese mes — mismo criterio que
	// generatePaymentDates en cartera-back.
	const diaElegidoClamped = Math.min(params.diaPagoMensualElegido, diasDelMes);

	const diasDiferencia = Math.max(
		0,
		diaElegidoClamped - params.diaPagoOriginalSistema,
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
