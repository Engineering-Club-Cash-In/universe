/**
 * Reglas puras de los KPIs del equipo del Dashboard del supervisor
 * (tareas S3 y S4 de docs/features/cobros-02/17-supervision-backend.md).
 * Decisiones en docs/features/cobros-02/23-plan-backend-supervision.md.
 */

/** Redondeo a entero, `null` si el denominador no sirve. */
export function porcentajeEntero(
	numerador: number,
	denominador: number | null | undefined,
): number | null {
	if (denominador == null || !(denominador > 0)) return null;
	return Math.round((numerador / denominador) * 100);
}

/**
 * Meta del equipo = suma de las metas (ya prorrateadas al período) de los
 * asesores que tienen meta. `null` si ninguno la tiene: el KPI muestra el
 * monto solo, sin barra.
 */
export function metaDelEquipo(
	metas: readonly (number | null)[],
): number | null {
	const conMeta = metas.filter((m): m is number => m != null && m > 0);
	if (conMeta.length === 0) return null;
	return Math.round(conMeta.reduce((a, b) => a + b, 0) * 100) / 100;
}

/** «Meta» del asesor, en %: recuperación del período ÷ meta prorrateada. */
export function metaCumplidaPct(
	recuperacion: number | null,
	meta: number | null,
): number | null {
	if (recuperacion == null) return null;
	return porcentajeEntero(recuperacion, meta);
}

/**
 * «Rescate» del asesor, en %: recuperados ÷ (recuperados + escalados) en el
 * período, es decir, cuántos de los movimientos de bucket de su cartera fueron
 * una mejora. Son los mismos dos números de la tarjeta «Migración de bucket».
 * No depende del tamaño de la cartera y, sin movimientos, es `null` («—»).
 */
export function rescatePct(
	recuperados: number,
	escalados: number,
): number | null {
	return porcentajeEntero(recuperados, recuperados + escalados);
}

/** Convierte el string decimal de cartera en número (0 si no es válido). */
export function montoDe(valor: string | number | null | undefined): number {
	const n = Number(valor);
	return Number.isFinite(n) ? n : 0;
}
