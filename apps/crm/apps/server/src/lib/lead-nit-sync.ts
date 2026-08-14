/**
 * El NIT que viaja a cartera (crédito y facturas del SAT) es el de la
 * OPORTUNIDAD, no el del lead: `closeOpportunity` lo lee de `opportunities.nit`.
 * Ese valor nace copiado del lead al crear la oportunidad, pero después se puede
 * corregir por aparte en el detalle de crédito (40%) y al asignar inversión
 * (50%).
 *
 * Por eso editar el NIT del lead solo debe propagarse a sus oportunidades
 * cuando no hay nada divergente que pisar: si las oportunidades del lead ya no
 * coinciden entre ellas, alguien corrigió una a mano para ese crédito en
 * concreto y esa corrección manda. Con una sola oportunidad no hay conflicto
 * posible, así que ahí sí se propaga.
 *
 * Vive en su propio módulo, sin tocar `db`, para poder verificarlo en tests.
 */

/**
 * Deja el NIT comparable: sin guiones ni espacios y en mayúsculas. Los vacíos
 * (null, "", "  ") colapsan a null para que "sin NIT" sea un solo valor.
 */
function normalizarNit(nit: string | null | undefined): string | null {
	const limpio = (nit ?? "").replace(/[-\s]/g, "").trim().toUpperCase();
	return limpio || null;
}

/**
 * @param opportunityNits NIT actual de cada oportunidad del lead
 * @returns true si el NIT del lead se puede propagar sin pisar correcciones
 */
export function canSyncNitToOpportunities(
	opportunityNits: Array<string | null | undefined>,
): boolean {
	if (opportunityNits.length === 0) return false;

	const distintos = new Set(opportunityNits.map(normalizarNit));
	return distintos.size === 1;
}
