/**
 * Labels en español para los enums del módulo de inversiones.
 */

const LEAD_SOURCE_LABELS: Record<string, string> = {
	website: "Sitio web",
	referral: "Referido",
	cold_call: "Llamada en frío",
	email: "Correo electrónico",
	social_media: "Redes sociales",
	event: "Evento",
	whatsapp: "WhatsApp",
};

const OPPORTUNITY_STATUS_LABELS: Record<string, string> = {
	open: "Abierta",
	won: "Ganada",
	lost: "Perdida",
};

export function formatLeadSource(source: string | null | undefined): string {
	if (!source) return "—";
	return LEAD_SOURCE_LABELS[source] ?? source;
}

export function formatOpportunityStatus(
	status: string | null | undefined,
): string {
	if (!status) return "—";
	return OPPORTUNITY_STATUS_LABELS[status] ?? status;
}
