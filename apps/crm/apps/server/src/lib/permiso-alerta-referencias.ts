import { puedeAccederDetalleBuro } from "./permiso-detalle-buro";
import { ROLES } from "./roles";

/**
 * Qué ve cada quien de la alerta de referencias repetidas (EXTRAIT-267). La
 * alerta habla de OTROS clientes. Del buró toma dos cosas:
 * - «detalle» (quién es el otro cliente, su oportunidad y cómo tiene a la
 *   referencia): solo quien ve el detalle del buró (`canAccessAnalysis`).
 * - ventas, solo en las oportunidades asignadas a sí mismo; en otra,
 *   «ninguno» (ni se busca).
 * Decisión propia, que el buró no comparte: el resto del personal (cobros,
 * contabilidad, jurídico, y ventas en lo suyo) recibe un «aviso», solo que la
 * referencia ya aparece en otros clientes y en cuántos. Al resumen del buró,
 * en cambio, cobros, contabilidad y jurídico no tienen acceso.
 */
export type NivelAlertaReferencias = "detalle" | "aviso" | "ninguno";

export function nivelAlertaReferencias(expediente: {
	userRole: string;
	userId: string;
	assignedTo: string;
}): NivelAlertaReferencias {
	const veElBuro = puedeAccederDetalleBuro(expediente);
	// Ventas ve el buró de su oportunidad, pero no su detalle.
	if (expediente.userRole === ROLES.SALES) {
		return veElBuro ? "aviso" : "ninguno";
	}
	return veElBuro ? "detalle" : "aviso";
}
