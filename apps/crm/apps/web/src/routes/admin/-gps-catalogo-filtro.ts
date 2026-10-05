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

/**
 * ¿Se puede clasificar el catálogo por bucket?
 * - `listos`: hay un bucket para cada crédito visible (o no hay créditos).
 * - `cargando`: la consulta está en vuelo, o el mapa que hay es de la búsqueda
 *   anterior (`keepPreviousData`) y le faltan los SIFCOs de la actual.
 * - `error`: la consulta falló y no hay mapa utilizable.
 *
 * Sin `listos` no se filtra: un mapa vacío o ajeno haría pasar a todas las
 * unidades con crédito por "sin bucket" y dejaría vacíos los demás buckets.
 */
export type EstadoBuckets = "listos" | "cargando" | "error";

export function estadoBuckets(p: {
	cantidadSifcos: number;
	tieneMapa: boolean;
	esDeBusquedaAnterior: boolean;
	hayError: boolean;
}): EstadoBuckets {
	if (p.cantidadSifcos === 0) return "listos";
	if (p.tieneMapa && !p.esDeBusquedaAnterior) return "listos";
	return p.hayError ? "error" : "cargando";
}

/** Aplica el filtro solo cuando los buckets están `listos`; si no, deja todo. */
export function filtrarUnidadesPorBucket<T extends UnidadFiltrable>(
	unidades: T[],
	filtro: string,
	estado: EstadoBuckets,
): T[] {
	if (estado !== "listos") return unidades;
	return unidades.filter((u) => pasaFiltroBucket(u, filtro));
}
