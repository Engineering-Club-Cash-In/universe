/**
 * Contrapropuesta de convenio (tarea M4 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md). Reglas puras.
 *
 * El supervisor cambia el número de cuotas y la fecha del primer pago del plan
 * que propuso el asesor; el total del convenio NO cambia, así que la cuota
 * mensual es el total entre las cuotas. Decisión 2026-10-12, doc 24.
 */

export const MAX_DIAS_HASTA_PRIMER_PAGO = 90;

export const redondear2 = (n: number) =>
	Math.round((n + Number.EPSILON) * 100) / 100;

export function cuotaMensualDe(total: number, meses: number): number {
	return redondear2(total / meses);
}

export interface PlanVigente {
	numeroMeses: number;
	primerPago: string | null;
}

/**
 * Primer motivo por el que la contrapropuesta no se puede enviar, o `null`.
 * `hoy` es el día de Guatemala (YYYY-MM-DD).
 */
export function motivoContrapropuestaInvalida(params: {
	numeroMeses: number;
	primerPago: string;
	hoy: string;
	maxMeses: number;
	actual: PlanVigente;
	/**
	 * Día de Guatemala (YYYY-MM-DD) en que se firmó el convenio. El primer pago
	 * tiene que ser posterior: las cuotas de ese día o anteriores cuentan como
	 * deuda vieja para el atraso del convenio.
	 */
	diaConvenio?: string;
}): string | null {
	const { numeroMeses, primerPago, hoy, maxMeses, actual, diaConvenio } =
		params;
	if (
		!Number.isInteger(numeroMeses) ||
		numeroMeses < 1 ||
		numeroMeses > maxMeses
	) {
		return `El número de cuotas debe estar entre 1 y ${maxMeses}.`;
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(primerPago)) {
		return "La fecha del primer pago no es válida.";
	}
	if (primerPago < hoy) {
		return "La fecha del primer pago no puede estar en el pasado.";
	}
	if (diaConvenio && primerPago <= diaConvenio) {
		return "El primer pago debe ser posterior al día en que se firmó el convenio.";
	}
	const limite = new Date(`${hoy}T00:00:00Z`);
	limite.setUTCDate(limite.getUTCDate() + MAX_DIAS_HASTA_PRIMER_PAGO);
	if (primerPago > limite.toISOString().slice(0, 10)) {
		return `El primer pago no puede ser dentro de más de ${MAX_DIAS_HASTA_PRIMER_PAGO} días.`;
	}
	if (numeroMeses === actual.numeroMeses && primerPago === actual.primerPago) {
		return "La contrapropuesta es igual al plan que propuso el asesor: cambie las cuotas o la fecha del primer pago.";
	}
	return null;
}

/**
 * ¿Puede responder esta persona? La responde el asesor que lleva el crédito
 * ahora (comparando correos sin importar mayúsculas ni espacios). Un
 * supervisor solo puede retirarla (descartarla).
 */
export function puedeResponderContrapropuesta(params: {
	accion: "aceptar" | "descartar";
	esSupervisor: boolean;
	emailSesion: string | null | undefined;
	emailAsesorDelCredito: string | null | undefined;
}): boolean {
	const norm = (v: string | null | undefined) =>
		v?.trim().toLowerCase() || null;
	const sesion = norm(params.emailSesion);
	const asesor = norm(params.emailAsesorDelCredito);
	if (sesion && asesor && sesion === asesor) return true;
	return params.esSupervisor && params.accion === "descartar";
}
