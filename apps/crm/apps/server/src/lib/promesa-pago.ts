/**
 * CB-020 — Evaluación de cumplimiento de Promesa de Pago (función pura, sin
 * DB ni red). Usada tanto por el endpoint on-demand (getEstadoPromesasPago,
 * dispara al abrir el caso) como por el job nocturno (check-promesas-pago.ts,
 * recorre todas las promesas pendientes sin depender de que alguien abra la
 * página) — una sola fuente de verdad para no divergir entre ambos.
 *
 * Dos chequeos INDEPENDIENTES (cartera-back NO separa la mora por cuota, es
 * un monto agregado del crédito, no por cuota individual — ver moras_credito):
 *  1. Rango de cuotas (cuotaInicio/cuotaFin) → TODAS deben estar pagado=true.
 *  2. incluyeMora=true → la mora ACTIVA del crédito debe estar saldada.
 */

import type { CreditoDirectoResponse } from "../types/cartera-back";

export type EstadoPromesa = "pendiente" | "cumplida" | "incumplida";

export interface PromesaAEvaluar {
	id: string;
	cuotaInicio: number | null;
	cuotaFin: number | null;
	incluyeMora: boolean;
	fechaPrometida: Date;
}

/**
 * Set de cuotas pagadas + si la mora está saldada — derivado UNA vez por
 * crédito.
 *
 * Falla-SEGURO, no falla-abierto: `mora` es `CarteraMoraCredito | null |
 * undefined`. `null` es dato real ("cartera-back consultó y no hay mora
 * activa") → SÍ cuenta como saldada. `undefined` (campo ausente del payload,
 * típico de un bug de red/parseo) NO se asume saldada — evita marcar
 * "cumplida" una promesa con incluyeMora cuando en realidad no sabemos el
 * estado real.
 */
export function derivarEstadoCredito(credito: CreditoDirectoResponse) {
	const cuotasPagadasSet = new Set(
		(credito.cuotasPagadas ?? []).map((c) => c.numero_cuota),
	);
	const moraSaldada =
		credito.mora === undefined
			? false
			: !credito.mora?.activa || Number(credito.moraActual || 0) <= 0;
	return { cuotasPagadasSet, moraSaldada };
}

export function evaluarPromesa(
	promesa: PromesaAEvaluar,
	estadoCredito: ReturnType<typeof derivarEstadoCredito>,
	hoy: Date = new Date(),
): EstadoPromesa {
	const tieneRango = promesa.cuotaInicio != null && promesa.cuotaFin != null;
	const rangoSaldado = tieneRango
		? Array.from(
				{ length: promesa.cuotaFin! - promesa.cuotaInicio! + 1 },
				(_, i) => promesa.cuotaInicio! + i,
			).every((n) => estadoCredito.cuotasPagadasSet.has(n))
		: true; // sin rango = no aplica este chequeo, no bloquea

	const moraOk = promesa.incluyeMora ? estadoCredito.moraSaldada : true;

	// Sin rango Y sin mora: la promesa no tiene ninguna obligación real que
	// verificar. rangoSaldado y moraOk son "true" por defecto (rama "no
	// aplica, no bloquea" de cada uno) — combinados, un AND vacío da
	// "cumplida" automática sin haber comprobado nada. createContactoCobros
	// ya rechaza esta combinación al CREAR (review Codex, fix anterior), pero
	// no protege filas legacy ya existentes en DB (creadas antes de ese
	// .refine(), o con columnas NULL por default sin backfill de la
	// migración) — confirmado con datos reales: 2 filas en dev con
	// cuota_inicio/cuota_fin/incluye_mora en null/null/false. Nunca "cumplida"
	// automática en este caso — cae al chequeo de fecha como cualquier otra.
	const tieneObligacion = tieneRango || promesa.incluyeMora;
	if (tieneObligacion && rangoSaldado && moraOk) return "cumplida";
	// fechaPrometida se guarda como MEDIANOCHE GT del día prometido (ver
	// gtDateStrToDate: T06:00:00Z = 00:00 GT). Comparar `fechaPrometida < hoy`
	// a secas (instante contra instante) daba gracia solo hasta la medianoche
	// GT, no el día completo: alguien abriendo el caso a mediodía del MISMO
	// día prometido ya veía "incumplida" (bug real, encontrado en review de
	// PR — el test que lo cubría comparaba fechaPrometida === hoy exacto, no
	// el caso real de "mismo día, hora distinta"). El corte real es el
	// SIGUIENTE día calendario: se suma 24h a fechaPrometida (ya normalizada
	// a medianoche GT) para obtener la medianoche GT del día después — recién
	// ahí, si `hoy` ya la pasó, cuenta como incumplida.
	const finDeGraciaGT = new Date(
		promesa.fechaPrometida.getTime() + 24 * 60 * 60 * 1000,
	);
	if (finDeGraciaGT <= hoy) return "incumplida";
	return "pendiente";
}
