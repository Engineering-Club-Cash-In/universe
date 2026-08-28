/**
 * CB-127 · Reglas de habilitación de las acciones de supervisor sobre un
 * grupo Págalo, extraídas del JSX para poder testearlas — es la parte con
 * más riesgo de ofrecer una acción que el server termine rechazando (el
 * server es la fuente de verdad final vía ESTADOS_INVALIDABLES_SUPERVISOR/
 * PagaloReemplazoInvalido; esto es solo para no mostrar un botón que sabemos
 * de antemano que siempre falla).
 */

export type EstadoGrupoPagalo =
	| "DRAFT"
	| "LINKS_PENDING"
	| "PENDING_PAYMENT"
	| "PARTIALLY_PAID"
	| "READY_TO_APPLY"
	| "APPLYING"
	| "COMPLETED"
	| "APPLICATION_FAILED"
	| "REVIEW_REQUIRED"
	| "CANCELLED";

export type AccionesDisponibles = {
	invalidar: boolean;
	regenerar: boolean;
	reintentar: boolean;
};

const ESTADOS_INVALIDABLES = new Set<EstadoGrupoPagalo>([
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"PARTIALLY_PAID",
	"REVIEW_REQUIRED",
	"APPLICATION_FAILED",
]);

// Mismo conjunto que invalidar, MENOS PARTIALLY_PAID: regenerar con dinero
// adentro siempre aborta en el server (invalidarGrupoEnTx rechaza cualquier
// link PAID) — no tiene sentido ofrecer un botón que sabemos que va a fallar
// siempre para ese estado puntual.
const ESTADOS_REGENERABLES = new Set<EstadoGrupoPagalo>([
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"REVIEW_REQUIRED",
	"APPLICATION_FAILED",
]);

export function accionesDisponibles(
	status: string,
	esSupervisor: boolean,
): AccionesDisponibles {
	if (!esSupervisor)
		return { invalidar: false, regenerar: false, reintentar: false };
	const estado = status as EstadoGrupoPagalo;
	return {
		invalidar: ESTADOS_INVALIDABLES.has(estado),
		regenerar: ESTADOS_REGENERABLES.has(estado),
		reintentar: estado === "APPLICATION_FAILED",
	};
}
