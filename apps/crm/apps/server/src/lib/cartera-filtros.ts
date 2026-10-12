/**
 * Reglas puras de los filtros server-side de la Cartera general (S5).
 */

/** Todos los buckets del funnel (B0 a B5), tal como los pide la cartera. */
export const BUCKETS_DEL_FUNNEL = [0, 1, 2, 3, 4, 5];

/**
 * S5: la cola del día y las alertas de promesa incluyen créditos INCOBRABLE
 * (B5). Sin etapa ni bucket, cartera consulta solo `ACTIVO` y los dejaba fuera
 * de la lista (el conteo de la cola no cuadraba con la cartera). Pidiendo todos
 * los buckets (0-5) cartera usa todo el funnel, que sí los incluye. Con
 * `estadoMora` explícito no se toca; las alertas de convenio tampoco lo
 * necesitan (EN_CONVENIO ya entra en `ACTIVO`).
 */
export function bucketsDelFunnelSiHaceFalta(input: {
	estadoMora?: string;
	cola?: unknown;
	alertaPromesa?: unknown;
}): number[] | undefined {
	if (input.estadoMora) return undefined;
	return input.cola || input.alertaPromesa
		? [...BUCKETS_DEL_FUNNEL]
		: undefined;
}
