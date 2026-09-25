import {
	isRejectionEligibleSignal,
	MIN_DOCUMENT_TYPE_REJECTION_CONFIDENCE,
} from "./ruleset";
import {
	currentValidationResult,
	type Signal,
	type ValidationResult,
} from "./types";

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
	signals: Pick<
		Signal,
		| "code"
		| "page"
		| "severity"
		| "weight"
		| "source"
		| "confidence"
		| "evidence"
	>[];
}): string {
	const result = currentValidationResult(params.result);
	const pageTextFor = (signals: typeof params.signals) => {
		const pages = [
			...new Set(
				signals
					.filter(
						(signal) => typeof signal.page === "number" && signal.page > 0,
					)
					.map((signal) => signal.page as number),
			),
		].sort((a, b) => a - b);
		return pages.length
			? `la${pages.length === 1 ? "" : "s"} página${pages.length === 1 ? "" : "s"} ${pages.join(", ")}`
			: null;
	};
	if (result === "error")
		return "Vuelve a intentar la validación. Si el error persiste, solicita un archivo PDF que pueda inspeccionarse.";
	if (result === "rechazado") {
		const pages = pageTextFor(params.signals.filter(isRejectionEligibleSignal));
		return pages
			? `Solicita un nuevo estado de cuenta que reemplace el contenido inválido de ${pages} y realiza una nueva validación documental.`
			: "Solicita un nuevo estado de cuenta válido y realiza una nueva validación documental antes de continuar.";
	}
	if (result === "revision_manual")
		return "Esta validación histórica requiere volver a cargar los documentos y realizar una nueva validación antes de continuar.";
	const advice = ["Puedes continuar al análisis de capacidad de pago."];
	const weightedPages = pageTextFor(
		params.signals.filter((signal) => signal.weight > 0),
	);
	if (weightedPages)
		advice.push(
			`Revisa ${weightedPages} tomando en cuenta las alertas informativas.`,
		);
	else if (params.signals.some((signal) => signal.weight > 0))
		advice.push("Revisa las alertas informativas del documento completo.");
	const alignmentSignals = params.signals.filter(
		(signal) => signal.code === "captura_impide_verificar_alineacion",
	);
	if (alignmentSignals.length) {
		const pages = pageTextFor(alignmentSignals);
		advice.push(
			`Se recomienda solicitar el PDF original o una foto frontal y nítida para comprobar la alineación${pages ? ` de ${pages}` : ""}.`,
		);
	}
	if (
		params.signals.some(
			(signal) => signal.code === "captura_con_legibilidad_insuficiente",
		)
	)
		advice.push(
			"Se recomienda solicitar el PDF original o una foto frontal y nítida para revisar el contenido ilegible.",
		);
	if (params.signals.some((signal) => signal.code === "errores_ortograficos"))
		advice.push(
			"Verifica con el banco si las faltas de ortografía provienen del documento original.",
		);
	return advice.join(" ");
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
	if (
		ai?.corresponde_al_tipo_declarado === true &&
		typeof ai.confianza_tipo_documento === "number" &&
		ai.confianza_tipo_documento >= MIN_DOCUMENT_TYPE_REJECTION_CONFIDENCE
	) {
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
