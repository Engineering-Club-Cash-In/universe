import { z } from "zod";

export const VALIDATION_RESULTS = [
	"valido",
	"observacion",
	"revision_manual",
	"rechazado",
	"error",
] as const;
export type ValidationResult = (typeof VALIDATION_RESULTS)[number];

export const SIGNAL_SEVERITIES = ["baja", "media", "alta"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];
export type SignalSource =
	| "bytes"
	| "estructura"
	| "contenido"
	| "ia"
	| "identidad"
	| "duplicado"
	| "emisor";

export interface Signal {
	code: string;
	label: string;
	severity: SignalSeverity;
	weight: number;
	source: SignalSource;
	evidence?: Record<string, string | number | boolean | null>;
	description?: string;
	page?: number | null;
	confidence?: number;
}

export interface AiForensicObservation {
	codigo: string;
	pagina: number | null;
	descripcion: string;
	confianza: number;
}

export interface DocumentIntegrityAiResult {
	corresponde_al_tipo_declarado: boolean;
	confianza_tipo_documento: number;
	tipo_documento_detectado: string;
	emisor_normalizado: string;
	periodo: { inicio: string; fin: string } | null;
	titular_detectado: string | null;
	identificador_detectado: string | null;
	es_legible: boolean;
	observaciones_forenses: AiForensicObservation[];
}

export interface ValidationOutcome {
	result: ValidationResult;
	score: number;
	reason: string;
	signals: Signal[];
}

export function createDocumentIntegrityAiSchema<
	const TObservation extends readonly [string, ...string[]],
	const TIssuer extends readonly [string, ...string[]],
>(observationCodes: TObservation, issuerValues: TIssuer) {
	const nullableText = z.string().trim().min(1).nullable().catch(null);
	return z.object({
		corresponde_al_tipo_declarado: z.boolean().catch(false),
		confianza_tipo_documento: z.number().min(0).max(100).catch(0),
		tipo_documento_detectado: z.string().trim().min(1).catch("desconocido"),
		emisor_normalizado: z.enum(issuerValues).catch("otro" as TIssuer[number]),
		periodo: z
			.object({
				inicio: z.string().date(),
				fin: z.string().date(),
			})
			.nullable()
			.catch(null),
		titular_detectado: nullableText,
		identificador_detectado: nullableText,
		es_legible: z.boolean().catch(false),
		observaciones_forenses: z
			.array(
				z.object({
					codigo: z.enum(observationCodes),
					pagina: z.number().int().positive().nullable().catch(null),
					descripcion: z.string().trim().max(240).catch("Observación visual"),
					confianza: z.number().min(0).max(100).catch(0),
				}),
			)
			.catch([]),
	});
}
