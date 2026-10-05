import type { client } from "@/utils/orpc";

export type OpportunityDocumentType = Parameters<
	typeof client.uploadOpportunityDocument
>[0]["documentType"];

// Opción de UI únicamente: la API conserva el tipo existente "other".
export const COFIRMANTE_BANK_STATEMENT_OPTION = {
	value: "cofirmante_estados_cuenta",
	label: "Estados de cuenta del cofirmante (adjunto)",
} as const;

export const COFIRMANTE_BANK_STATEMENT_HELP =
	"Adjunta uno o varios archivos, uno a la vez. Se guardan como Otro con descripción de cofirmante; no completan los 3 meses del titular ni modifican su análisis de capacidad. El análisis del cofirmante se realiza en su sección.";

export type ManualOpportunityDocumentType =
	| OpportunityDocumentType
	| typeof COFIRMANTE_BANK_STATEMENT_OPTION.value;

export function getManualOpportunityDocumentFields(
	documentType: ManualOpportunityDocumentType,
	description?: string,
): { documentType: OpportunityDocumentType; description: string | undefined } {
	return documentType === COFIRMANTE_BANK_STATEMENT_OPTION.value
		? {
				documentType: "other",
				description: description?.trim()
					? `Estados de cuenta del cofirmante: ${description.trim()}`
					: "Estados de cuenta del cofirmante",
			}
		: { documentType, description: description || undefined };
}
