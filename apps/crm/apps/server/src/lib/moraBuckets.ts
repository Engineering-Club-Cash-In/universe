/**
 * Fuente única de verdad (lado CRM) de los buckets de aging de mora por cuotas
 * atrasadas. Espejo de `apps/cartera-back/src/config/moraBuckets.ts`: mantener
 * ambos alineados. Todo lo que mapea una etapa (estadoMora) a un rango de cuotas
 * deriva de aquí — agregar/mover una etapa se hace solo en esta lista.
 *
 * Semántica del rango:
 *   - `min` inclusivo.
 *   - `max = null`  → sin tope: cuenta `>= min` (el bucket "+", el último).
 *   - `min === max` → exacto: cuenta `= min`.
 *   - `min < max`   → rango cerrado: `BETWEEN min AND max`.
 */
export interface MoraBucket {
	/** Clave numérica que devuelve cartera-back en `porCuotasAtrasadas`. */
	key: string;
	/** Etapa de mora que consume el frontend / casos_cobros. */
	estadoMora: string;
	/** Mínimo de cuotas atrasadas (inclusivo). */
	min: number;
	/** Máximo de cuotas atrasadas (inclusivo). `null` = sin tope (>= min). */
	max: number | null;
	/** Nombre de negocio mostrado en el frontend (embudo + filtros). */
	label: string;
}

export const MORA_BUCKETS: readonly MoraBucket[] = [
	{ key: "0", estadoMora: "al_dia", min: 0, max: 0, label: "Cartera Sana" },
	{ key: "1", estadoMora: "mora_30", min: 1, max: 1, label: "Alerta Temprana" },
	{ key: "2", estadoMora: "mora_60", min: 2, max: 2, label: "Gestión Activa" },
	{ key: "3", estadoMora: "mora_90", min: 3, max: 3, label: "Rescate" },
	{ key: "4", estadoMora: "mora_120", min: 4, max: 4, label: "Última Instancia / Pre Jurídico" },
	{ key: "5", estadoMora: "mora_120_plus", min: 5, max: null, label: "Jurídico" },
] as const;

/** Rango { min, max } de cuotas atrasadas para una etapa. `undefined` si no aplica filtro por cuotas. */
export function rangoCuotasPorEstadoMora(
	estadoMora: string,
): { min: number; max: number | undefined } | undefined {
	const b = MORA_BUCKETS.find((x) => x.estadoMora === estadoMora);
	if (!b) return undefined;
	return { min: b.min, max: b.max ?? undefined };
}

/** Nombre de negocio (label) de una etapa. `undefined` si no es bucket de aging. */
export function labelPorEstadoMora(estadoMora: string): string | undefined {
	return MORA_BUCKETS.find((b) => b.estadoMora === estadoMora)?.label;
}

/** Etapa de mora correspondiente a un número de cuotas atrasadas. */
export function estadoMoraPorCuotas(cuotas: number): string {
	for (const b of MORA_BUCKETS) {
		const dentro = b.max === null ? cuotas >= b.min : cuotas >= b.min && cuotas <= b.max;
		if (dentro) return b.estadoMora;
	}
	return "al_dia";
}
