const ETIQUETAS_MOTIVO_AGENDA: Record<string, string> = {
	"D-0": "Pago programado",
	sla_hoy: "Gestión SLA programada",
	promesa_hoy: "Promesa programada",
};

export function etiquetaMotivoAgenda(motivo: string | null): string {
	if (!motivo) return "—";
	return ETIQUETAS_MOTIVO_AGENDA[motivo] ?? motivo;
}

/**
 * Tres estados, no dos: `null` significa que el server no pudo evaluar si la
 * gestión estaba en agenda (no se pidió, o no hay agenda cerrada esa fecha) —
 * no es lo mismo que "fuera de agenda", que sí es una afirmación.
 *
 * CB-114: `enAgendaDeTitular` cubre el cuarto caso — no estaba en la agenda de
 * quien gestionó, pero sí en la de un titular ausente que estaba cubriendo.
 * Decir "Fuera de agenda" a secas ahí se lee como trabajo no planificado,
 * cuando era trabajo planificado de otra persona.
 */
export function etiquetaEnAgenda(
	enAgenda: boolean | null | undefined,
	enAgendaDeTitular?: string | null,
): string {
	if (enAgenda) return "En agenda";
	// El titular manda incluso con `enAgenda == null`: si se resolvió un nombre,
	// hay snapshot de ese día y la respuesta se conoce.
	if (enAgendaDeTitular) return `En agenda de ${enAgendaDeTitular}`;
	if (enAgenda == null) return "—";
	return "Fuera de agenda";
}
