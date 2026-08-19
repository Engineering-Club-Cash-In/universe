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
 */
export function etiquetaEnAgenda(enAgenda: boolean | null | undefined): string {
	if (enAgenda == null) return "—";
	return enAgenda ? "En agenda" : "Fuera de agenda";
}
