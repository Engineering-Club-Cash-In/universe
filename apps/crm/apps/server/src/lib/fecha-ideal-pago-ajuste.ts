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

function redondearMonto(valor: number): number {
	return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Días del mes en que cae la primera cuota del crédito, calculado con la misma
 * lógica de "mes actual + 1" que usa generatePaymentDates en cartera-back
 * (apps/cartera-back/src/controllers/createCredit.ts), para que el denominador
 * del prorrateo coincida con el mes real donde va a caer esa primera cuota.
 *
 * A propósito NO usa hora Guatemala: generatePaymentDates elige el mes con
 * getFullYear()/getMonth() en hora local del server (no GT), así que replicar
 * esa misma fuente es lo que mantiene sincronizados numerador y denominador —
 * usar GT aquí desincroniza el mes cerca de medianoche GT si el server corre
 * en UTC (ej. 31 a las 7pm GT ya es día 1 de UTC: cartera-back agenda la
 * primera cuota un mes adelante de lo que este cálculo asumiría con GT).
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
	const diaElegidoClamped = Math.min(
		params.diaPagoMensualElegido,
		diasDelMes,
	);

	const diasDiferencia = Math.max(
		0,
		diaElegidoClamped - params.diaPagoOriginalSistema,
	);

	if (diasDiferencia === 0) return null;

	const interesMensual = (params.capital * params.porcentajeInteres) / 100;
	const serviciosMensual = params.seguroMensual + params.gpsMensual;

	const montoInteres = redondearMonto(
		(interesMensual / diasDelMes) * diasDiferencia,
	);
	const montoMembresia = redondearMonto(
		(params.membresiaMensual / diasDelMes) * diasDiferencia,
	);
	const montoServicios = redondearMonto(
		(serviciosMensual / diasDelMes) * diasDiferencia,
	);

	return {
		diasDiferencia,
		diasDelMes,
		montoInteres,
		montoMembresia,
		montoServicios,
		montoTotal: redondearMonto(montoInteres + montoMembresia + montoServicios),
	};
}
