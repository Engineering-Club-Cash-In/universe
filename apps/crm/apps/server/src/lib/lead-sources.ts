export const LEAD_SOURCE_LABELS = {
	website: "Sitio Web",
	referral: "Referencia",
	cold_call: "Llamada en Frío",
	email: "Correo Electrónico",
	social_media: "Redes Sociales",
	event: "Evento",
	other: "Otro",
	facebook: "Facebook",
	instagram: "Instagram",
	google: "Google",
	meta: "Meta",
	linkedin: "LinkedIn",
	Whatsapp: "WhatsApp",
	agency: "Agencia",
	property: "Predio",
	recurrent: "Recurrente",
	recurrent_active: "Recurrente Activo",
} as const satisfies Record<string, string>;

export type LeadSource = keyof typeof LEAD_SOURCE_LABELS;
export type LeadSourceChannelType =
	| "Físico"
	| "Pauta Digital"
	| "Orgánico Digital"
	| "Otros";

const LEAD_SOURCE_CHANNEL_TYPES = {
	property: "Físico",
	agency: "Físico",
	google: "Pauta Digital",
	meta: "Pauta Digital",
	facebook: "Pauta Digital",
	instagram: "Pauta Digital",
	Whatsapp: "Pauta Digital",
	website: "Orgánico Digital",
	social_media: "Orgánico Digital",
	recurrent: "Otros",
	recurrent_active: "Otros",
	other: "Otros",
	referral: "Otros",
} as const satisfies Partial<Record<LeadSource, LeadSourceChannelType>>;

export const LEAD_SOURCE_OPTIONS = Object.entries(LEAD_SOURCE_LABELS).map(
	([value, label]) => ({
		value,
		label,
	}),
);

export const LEAD_SOURCE_BADGE_CLASSES = {
	website: "bg-indigo-100 text-indigo-800",
	referral: "bg-green-100 text-green-800",
	cold_call: "bg-orange-100 text-orange-800",
	email: "bg-blue-100 text-blue-800",
	social_media: "bg-pink-100 text-pink-800",
	event: "bg-purple-100 text-purple-800",
	other: "bg-gray-100 text-gray-800",
	facebook: "bg-blue-100 text-blue-800",
	instagram: "bg-pink-100 text-pink-800",
	google: "bg-red-100 text-red-800",
	meta: "bg-sky-100 text-sky-800",
	linkedin: "bg-blue-100 text-blue-800",
	Whatsapp: "bg-emerald-100 text-emerald-800",
	agency: "bg-teal-100 text-teal-800",
	property: "bg-amber-100 text-amber-800",
	recurrent: "bg-violet-100 text-violet-800",
	recurrent_active: "bg-cyan-100 text-cyan-800",
} as const satisfies Record<keyof typeof LEAD_SOURCE_LABELS, string>;

export function getLeadSourceLabel(source: string | null | undefined): string {
	if (!source) return "Sin fuente";
	return (
		LEAD_SOURCE_LABELS[source as keyof typeof LEAD_SOURCE_LABELS] ?? source
	);
}

export function getLeadSourceChannelType(
	source: string | null | undefined,
): LeadSourceChannelType {
	if (!source) return "Otros";
	return (
		LEAD_SOURCE_CHANNEL_TYPES[
			source as keyof typeof LEAD_SOURCE_CHANNEL_TYPES
		] ?? "Otros"
	);
}

export function getLeadSourceBadgeClass(source: string): string {
	return (
		LEAD_SOURCE_BADGE_CLASSES[
			source as keyof typeof LEAD_SOURCE_BADGE_CLASSES
		] ?? "bg-gray-100 text-gray-800"
	);
}
