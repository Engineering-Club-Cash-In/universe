import type { Signal } from "./types";

const ISSUER_LABELS: Record<string, string> = {
	banrural: "Banrural",
	banco_industrial: "Banco Industrial",
	gyt_continental: "Banco G&T Continental",
	bac: "BAC",
	promerica: "Banco Promerica",
	banco_de_antigua: "Banco de Antigua",
	banco_inmobiliario: "Banco Inmobiliario",
	interbanco: "Interbanco",
	banco_azteca: "Banco Azteca",
	ficohsa: "Ficohsa",
	vivibanco: "Vivibanco",
	banco_de_los_trabajadores: "Banco de los Trabajadores",
};

export interface PositiveCheck {
	code: string;
	label: string;
}

export function buildDocumentPositiveChecks(params: {
	aiRawResponse: Record<string, unknown> | null;
	signals: Pick<Signal, "code" | "source" | "weight">[];
}): PositiveCheck[] {
	const checks: PositiveCheck[] = [];
	const ai = params.aiRawResponse;
	const signalCodes = new Set(params.signals.map((signal) => signal.code));
	if (ai?.es_legible === true) {
		checks.push({
			code: "documento_legible",
			label: "El documento es legible.",
		});
	}
	if (ai?.corresponde_al_tipo_declarado === true) {
		checks.push({
			code: "tipo_documento_confirmado",
			label: "Fue reconocido como un estado de cuenta.",
		});
	}
	const issuer =
		typeof ai?.emisor_normalizado === "string"
			? ISSUER_LABELS[ai.emisor_normalizado]
			: undefined;
	if (issuer) {
		checks.push({
			code: "emisor_identificado",
			label: `El emisor fue identificado como ${issuer}.`,
		});
	}
	if (
		typeof ai?.titular_detectado === "string" &&
		ai.titular_detectado.trim() &&
		signalCodes.has("identidad_comparada")
	) {
		checks.push({
			code: "titular_coincide",
			label: "El titular coincide con una persona del expediente.",
		});
	}
	if (
		Array.isArray(ai?.observaciones_forenses) &&
		ai.observaciones_forenses.length === 0
	) {
		checks.push({
			code: "sin_anomalias_visuales",
			label: "No se detectaron anomalías visuales.",
		});
	}
	if (
		!signalCodes.has("inspeccion_tecnica_incompleta") &&
		!params.signals.some(
			(signal) =>
				signal.weight > 0 &&
				["bytes", "estructura", "contenido"].includes(signal.source),
		)
	) {
		checks.push({
			code: "estructura_sin_alertas",
			label: "La estructura del PDF no presentó alertas técnicas.",
		});
	}
	return checks;
}
