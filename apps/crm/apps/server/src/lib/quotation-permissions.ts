import {
	canAccessSalesTeamActions,
	canManageAnySalesOwnedRecord,
} from "./sales-permissions";

export function canManageQuotations(role: string | null | undefined): boolean {
	return canAccessSalesTeamActions(role);
}

export function canManageAnyQuotation(role: string | null | undefined): boolean {
	return canManageAnySalesOwnedRecord(role);
}

/**
 * Por qué no se puede borrar una cotización, o null. Con la oportunidad ganada
 * el crédito ya se armó con sus cotizaciones, y la del cierre es la que usa el
 * correo de la factura a la aseguradora.
 */
export function motivoParaNoBorrarCotizacion(caso: {
	estadoOportunidad: string | null;
	esDelCierre: boolean;
}): string | null {
	if (caso.estadoOportunidad === "won") {
		return "No se puede eliminar una cotización de una oportunidad ganada";
	}
	if (caso.esDelCierre) {
		return "Esta cotización es la que usó el cierre del crédito y no se puede eliminar";
	}
	return null;
}
