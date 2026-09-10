import { isRejectionEligibleSignal } from "./ruleset";
import type { Signal, ValidationResult } from "./types";

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

export function buildDocumentRecommendedAction(params: {
	result: ValidationResult;
	signals: Pick<Signal, "code" | "page" | "severity" | "weight">[];
}): string {
	const pageSignals =
		params.result === "rechazado"
			? params.signals.filter(isRejectionEligibleSignal)
			: params.signals.filter((signal) => signal.weight > 0);
	const pages = [
		...new Set(
			pageSignals
				.filter((signal) => typeof signal.page === "number" && signal.page > 0)
				.map((signal) => signal.page as number),
		),
	].sort((left, right) => left - right);
	const pageText =
		pages.length > 0
			? ` la${pages.length === 1 ? "" : "s"} página${pages.length === 1 ? "" : "s"} ${pages.join(", ")}`
			: null;

	switch (params.result) {
		case "valido":
			return "El documento puede continuar al análisis de capacidad de pago.";
		case "observacion":
			return pageText
				? `Verifica${pageText} antes de continuar.`
				: "Puedes continuar, tomando en cuenta las observaciones indicadas.";
		case "revision_manual":
			return pageText
				? `Revisa${pageText}. Si no puedes confirmar su legitimidad, solicita un nuevo estado de cuenta; solo un supervisor puede aprobarlo con justificación.`
				: "Revisa las señales del documento completo. Si no puedes confirmar su legitimidad, solicita un nuevo estado de cuenta; solo un supervisor puede aprobarlo con justificación.";
		case "rechazado":
			return pageText
				? `Solicita un nuevo estado de cuenta que reemplace el contenido inválido de${pageText} y realiza una nueva validación documental.`
				: "Solicita un nuevo estado de cuenta válido y realiza una nueva validación documental antes de continuar.";
		case "error":
			return "Vuelve a intentar la validación. Si el error persiste, solicita un nuevo archivo PDF.";
	}
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
