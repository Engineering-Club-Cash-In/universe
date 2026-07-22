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

	if (rangoSaldado && moraOk) return "cumplida";
	// fechaPrometida se guarda como medianoche del día prometido (ver
	// $id.tsx/contacto-modal) — la comparación estricta `<` da gracia el DÍA
	// COMPLETO de la promesa: solo pasa a incumplida a partir del día
	// siguiente. Intencional: "prometió pagar hoy" no debe marcarse vencida
	// mientras el día sigue corriendo (coincide con el criterio de la Cola
	// del día, donde una promesa que vence HOY sigue vigente hasta medianoche).
	if (promesa.fechaPrometida < hoy) return "incumplida";
	return "pendiente";
}
