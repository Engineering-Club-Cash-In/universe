/**
 * El NIT que viaja a cartera (crédito y facturas del SAT) es el de la
 * OPORTUNIDAD, no el del lead: `closeOpportunity` lo lee de `opportunities.nit`.
 * Ese valor nace copiado del lead al crear la oportunidad, pero después se puede
 * corregir por aparte en el detalle de crédito (40%) y al asignar inversión
 * (50%).
 *
 * Por eso al editar el NIT del lead solo se propaga a las oportunidades que
 * siguen con la copia intacta. La referencia para saberlo es el NIT que el lead
 * tenía ANTES de la edición: si la oportunidad todavía coincide con él, nadie la
 * tocó; si difiere, alguien la corrigió a mano para ese crédito y esa corrección
 * manda. Comparar las oportunidades entre ellas no sirve —una oportunidad sola,
 * o varias corregidas al mismo valor, también "coinciden" y se perderían igual.
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
 * @param opportunityNit NIT actual de la oportunidad
 * @param previousLeadNit NIT que el lead tenía antes de esta edición
 * @returns true si la oportunidad sigue con la copia del lead y se puede
 * actualizar sin pisar una corrección manual
 */
export function canSyncNitToOpportunity(
	opportunityNit: string | null | undefined,
	previousLeadNit: string | null | undefined,
): boolean {
	const actual = normalizarNit(opportunityNit);

	// Sin NIT propio no hay nada que preservar: la oportunidad se creó antes de
	// que el lead tuviera NIT, o la copia nunca ocurrió.
	if (actual === null) return true;

	return actual === normalizarNit(previousLeadNit);
}
