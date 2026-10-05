/**
 * Filtro por bucket del catálogo de unidades GPS. Lógica pura: una unidad pasa
 * si alguno de sus créditos está en el bucket elegido (una unidad compartida
 * puede tener más de uno).
 */

export const FILTRO_BUCKET_TODOS = "todos";
export const FILTRO_BUCKET_SIN_CREDITO = "sin_credito";
/** Tiene créditos, pero ninguno con bucket (fuera del funnel o que cartera no conoce). */
export const FILTRO_BUCKET_SIN_BUCKET = "sin_bucket";

/**
 * Buckets de aging B0-B5 (estado de mora de cada uno). El bucket viene del motor
 * de cartera-back, que siempre da uno de estos (un crédito en convenio lleva el
 * bucket que tenía), así que "en convenio" no es una opción del filtro.
 */
export const ESTADOS_FILTRO_BUCKET = [
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
] as const;

export interface UnidadFiltrable {
	creditos: { numeroSifco: string }[];
	estadoMoraPorSifco: Record<string, string>;
}

export function estadosDeUnidad(u: UnidadFiltrable): string[] {
	const estados: string[] = [];
	for (const c of u.creditos) {
		const e = u.estadoMoraPorSifco[c.numeroSifco];
		if (e && !estados.includes(e)) estados.push(e);
	}
	return estados;
}

export function pasaFiltroBucket(u: UnidadFiltrable, filtro: string): boolean {
	if (filtro === FILTRO_BUCKET_TODOS) return true;
	if (filtro === FILTRO_BUCKET_SIN_CREDITO) return u.creditos.length === 0;
	const estados = estadosDeUnidad(u);
	if (filtro === FILTRO_BUCKET_SIN_BUCKET) {
		return u.creditos.length > 0 && estados.length === 0;
	}
	return estados.includes(filtro);
}
