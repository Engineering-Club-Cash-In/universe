const ETIQUETAS_MOTIVO_AGENDA: Record<string, string> = {
	"D-0": "Pago programado",
	sla_hoy: "Gestión SLA programada",
	promesa_hoy: "Promesa programada",
};

export function etiquetaMotivoAgenda(motivo: string | null): string {
	if (!motivo) return "—";
	return ETIQUETAS_MOTIVO_AGENDA[motivo] ?? motivo;
}
