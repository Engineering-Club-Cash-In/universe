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

// APPLICATION_FAILED solo se alcanza vía READY_TO_APPLY, que evaluarGrupo
// (pagalo-poll.ts) únicamente pone cuando TODOS los links requeridos ya
// están isApplicationSource=true — o sea, un grupo APPLICATION_FAILED
// SIEMPRE tiene al menos un link PAID adentro. Igual PARTIALLY_PAID, por
// definición del estado. invalidarGrupoEnTx rechaza cualquier grupo con un
// link PAID, así que Invalidar/Regenerar en esos dos estados fallaban
// siempre con el toast de conflicto (hallazgo de code review — ya se había
// excluido PARTIALLY_PAID de regenerar, pero no de invalidar, ni
// APPLICATION_FAILED de ninguno de los dos). REVIEW_REQUIRED se deja: puede
// o no tener un pago adentro (a veces es solo un fallo de validación
// determinístico), así que ahí el server sigue siendo quien decide.
const ESTADOS_INVALIDABLES = new Set<EstadoGrupoPagalo>([
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"REVIEW_REQUIRED",
]);

const ESTADOS_REGENERABLES = new Set<EstadoGrupoPagalo>([
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"REVIEW_REQUIRED",
]);

/**
 * Estados donde reintentar la aplicación es el retry idempotente de siempre
 * (D-13): hay evidencia completa y el comando es el mismo que mandaría el
 * ciclo automático. `READY_TO_APPLY` estaba fuera de esta lista aunque el
 * server siempre lo aceptó, así que un grupo que quedaba esperando el
 * dispatcher no tenía botón para empujarlo.
 */
const ESTADOS_REINTENTABLES = new Set<EstadoGrupoPagalo>([
	"APPLICATION_FAILED",
	"READY_TO_APPLY",
]);

/**
 * Los dos que el ciclo automático NO vuelve a tocar solo porque esperan a una
 * persona: revisión de cartera, y un grupo colgado en APPLYING por un proceso
 * que murió. Forzarlos es decisión de admin (el server exige lo mismo, y en
 * APPLYING además que el lease esté vencido).
 */
const ESTADOS_FORZABLES_ADMIN = new Set<EstadoGrupoPagalo>([
	"REVIEW_REQUIRED",
	"APPLYING",
]);

/**
 * `esAdmin` no se pregunta aparte de `esSupervisor` por jerarquía: el admin ya
 * pasa `canAssignCobros`, así que siempre llega acá como supervisor también.
 * Sirve solo para abrir los dos estados forzables.
 */
export function accionesDisponibles(
	status: string,
	esSupervisor: boolean,
	esAdmin = false,
): AccionesDisponibles {
	if (!esSupervisor)
		return { invalidar: false, regenerar: false, reintentar: false };
	const estado = status as EstadoGrupoPagalo;
	return {
		invalidar: ESTADOS_INVALIDABLES.has(estado),
		regenerar: ESTADOS_REGENERABLES.has(estado),
		reintentar:
			ESTADOS_REINTENTABLES.has(estado) ||
			(esAdmin && ESTADOS_FORZABLES_ADMIN.has(estado)),
	};
}

/** ¿Este reintento es de los que solo un admin puede disparar? */
export function esReintentoForzado(status: string, esAdmin: boolean): boolean {
	return esAdmin && ESTADOS_FORZABLES_ADMIN.has(status as EstadoGrupoPagalo);
}
