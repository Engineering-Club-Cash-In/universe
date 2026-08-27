/**
 * Resolución de las entidades que aparecen en los contratos:
 * {empresa}, {entidad} y {tipoEntidad}.
 *
 * Los valores están verificados contra `contract_generation_snapshots`, que
 * guarda lo que jurídico llenó a mano en contratos ya generados.
 */

/** Entrada del JSON que escribe InvestmentAssignmentSection. */
export interface OpportunityInvestor {
	inversionista_id: number;
	nombre: string;
	porcentaje_participacion?: number;
	monto_aportado?: number;
}

/** Valores de `investors.clientType` (enum `investor_client_type`). */
export type InvestorClientType =
	| "individual"
	| "empresa_individual"
	| "sociedad_anonima";

/**
 * Lee `opportunities.inversionistas`, que es un `text` con JSON y puede venir
 * nulo, vacío o corrupto en registros viejos.
 */
export function parseOpportunityInvestors(
	raw: string | null | undefined,
): OpportunityInvestor[] {
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		return parsed.filter(
			(item): item is OpportunityInvestor =>
				typeof item?.nombre === "string" && item.nombre.trim() !== "",
		);
	} catch {
		return [];
	}
}

/**
 * El contrato tiene un solo {entidad} pero la oportunidad admite hasta 20
 * inversionistas: manda el de mayor participación, que es el acreedor
 * principal del crédito.
 */
export function selectPrimaryInvestor(
	investors: OpportunityInvestor[],
): OpportunityInvestor | null {
	if (investors.length === 0) return null;

	return investors.reduce((mayor, actual) => {
		const porParticipacion =
			(actual.porcentaje_participacion ?? 0) -
			(mayor.porcentaje_participacion ?? 0);
		if (porParticipacion !== 0) return porParticipacion > 0 ? actual : mayor;

		const porMonto = (actual.monto_aportado ?? 0) - (mayor.monto_aportado ?? 0);
		return porMonto > 0 ? actual : mayor;
	});
}

/**
 * Detecta una sociedad por cómo está escrito el nombre: "... S.A.",
 * "..., S. A." o "... SOCIEDAD ANONIMA".
 *
 * Exige un espacio o coma antes de la "S" para no confundirse con nombres de
 * persona que casualmente terminan parecido (Asensio, Massis, Bahaia).
 */
export function looksLikeCorporation(nombre: string): boolean {
	// Varios nombres traen una aclaración final entre paréntesis con el
	// representante ("Finsolar S.A. (Escondrillas)"): estorba al sufijo.
	const limpio = nombre
		.trim()
		.replace(/\s*\([^)]*\)\s*$/, "")
		.trim();
	return (
		/sociedad\s+an[oó]nima\s*$/i.test(limpio) ||
		/(^|[\s,])s\.?\s*a\.?\s*$/i.test(limpio)
	);
}

/**
 * Texto de {tipoEntidad}, que la plantilla usa como
 * "celebrado entre {tipoEntidad}: {entidad}".
 *
 * Prioriza el tipo explícito del catálogo local de inversionistas; si no está
 * (hoy ninguna fila tiene el enlace a cartera-back poblado), lo deduce del
 * nombre. "la entidad" es el valor que jurídico usó 6387 veces.
 */
export function resolveEntityType(
	clientType: InvestorClientType | null | undefined,
	nombre: string,
): string {
	switch (clientType) {
		case "sociedad_anonima":
			return "la entidad";
		case "empresa_individual":
			return "la empresa";
		case "individual":
			return "la persona";
		default:
			// Sin tipo explícito: el sufijo del nombre acierta en el 99.8% de las
			// oportunidades reales, donde el acreedor es Cube Investments S.A.
			return looksLikeCorporation(nombre) ? "la entidad" : "la persona";
	}
}
