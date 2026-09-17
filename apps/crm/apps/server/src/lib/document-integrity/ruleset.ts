import type {
	DocumentIntegrityAiResult,
	Signal,
	ValidationOutcome,
} from "./types";

export const LLM_WEIGHT_CAP = 8;
export const MIN_SYNTHETIC_REJECTION_CONFIDENCE = 90;
export const MIN_DOCUMENT_TYPE_REJECTION_CONFIDENCE = 95;

const REJECTION_ELIGIBLE_SIGNAL_CODES = new Set([
	"documento_declarado_sintetico_o_sin_validez",
]);

export function isRejectionEligibleSignal(
	signal: Pick<
		Signal,
		"code" | "severity" | "source" | "confidence" | "page" | "evidence"
	>,
): boolean {
	const eligible =
		signal.severity === "alta" &&
		REJECTION_ELIGIBLE_SIGNAL_CODES.has(signal.code);
	if (!eligible) return false;
	return (
		(signal.confidence ?? 0) >= MIN_SYNTHETIC_REJECTION_CONFIDENCE &&
		typeof signal.page === "number" &&
		signal.page > 0 &&
		typeof signal.evidence?.textoDetectado === "string" &&
		signal.evidence.textoDetectado.trim().length > 0
	);
}

export const SIGNAL_WEIGHTS: Record<string, number> = {
	ortografia_en_descripcion_movimiento: 0,
	tipografia_inconsistente: 0,
	captura_impide_verificar_alineacion: 0,
	errores_ortograficos: 4,
	productor_es_editor: 0,
	xmp_historial_de_ediciones: 7,
	creacion_anterior_al_cierre_del_periodo: 0,
	xmp_contradice_info_dict: 6,
	productor_es_navegador_o_ofimatica: 4,
	moddate_posterior_a_creationdate: 3,
	sin_metadata_de_creacion: 0,
	actualizaciones_incrementales: 4,
	una_actualizacion_incremental: 2,
	encrypt_de_emisor_intacto: -2,
	encrypt_ausente_pero_esperado: 3,
	pdf_protegido_no_abre: 0,
	paginas_mixtas_texto_e_imagen: 0,
	todas_las_paginas_rasterizadas: 0,
	documento_fotografiado_o_escaneado: 0,
	captura_con_legibilidad_insuficiente: 0,
	fuente_no_embebida: 0,
	fuente_type3: 2,
	huella_coincide_con_emisor: -2,
	huella_no_coincide_con_emisor: 3,
	titular_no_coincide_fuerte: 6,
	titular_no_coincide_parcial: 3,
	sha256_duplicado_oportunidad_ganada: 6,
	sha256_duplicado_otro_expediente: 0,
	identificador_duplicado_otro_lead: 0,
	sha256_duplicado_mismo_expediente: 0,
	documento_declarado_sintetico_o_sin_validez: 7,
	ia_no_disponible: 0,
	inspeccion_tecnica_incompleta: 0,
	tipo_documento_incierto: 0,
	identidad_comparada: 0,
};

export const SIGNAL_LABELS: Record<string, string> = {
	ortografia_en_descripcion_movimiento:
		"Ortografía en la descripción de un movimiento",
	documento_fotografiado_o_escaneado:
		"El documento contiene fotografías o escaneos",
	captura_con_legibilidad_insuficiente:
		"La captura no permite leer correctamente el documento",
	tipografia_inconsistente: "Tipografía inconsistente",
	captura_impide_verificar_alineacion:
		"La captura impide verificar la alineación",
	errores_ortograficos: "Faltas de ortografía o acentuación",
	productor_es_editor: "El PDF fue procesado por una herramienta externa",
	xmp_historial_de_ediciones: "El historial XMP contiene múltiples guardados",
	creacion_anterior_al_cierre_del_periodo:
		"El PDF fue creado antes del cierre del período declarado",
	xmp_contradice_info_dict: "Los metadatos XMP contradicen el diccionario Info",
	productor_es_navegador_o_ofimatica:
		"El productor del PDF es un navegador o una suite ofimática",
	moddate_posterior_a_creationdate:
		"La fecha de modificación es posterior a la creación",
	sin_metadata_de_creacion: "El PDF no contiene fecha de creación",
	actualizaciones_incrementales:
		"El PDF contiene varias actualizaciones incrementales",
	una_actualizacion_incremental:
		"El PDF contiene una actualización incremental",
	encrypt_de_emisor_intacto:
		"El cifrado coincide con la huella conocida del emisor",
	encrypt_ausente_pero_esperado: "Falta el cifrado esperado para el emisor",
	pdf_protegido_no_abre: "El PDF está protegido y no se pudo inspeccionar",
	paginas_mixtas_texto_e_imagen:
		"El PDF mezcla páginas de texto y páginas rasterizadas",
	todas_las_paginas_rasterizadas: "Todas las páginas están rasterizadas",
	fuente_no_embebida: "Hay fuentes no embebidas",
	fuente_type3: "El PDF utiliza una fuente Type 3",
	huella_coincide_con_emisor: "La huella técnica coincide con el emisor",
	huella_no_coincide_con_emisor: "La huella técnica no coincide con el emisor",
	titular_no_coincide_fuerte:
		"El titular no coincide con las personas del expediente",
	titular_no_coincide_parcial:
		"El titular coincide parcialmente con una persona del expediente",
	sha256_duplicado_oportunidad_ganada:
		"El mismo archivo ya fue utilizado en una oportunidad ganada",
	sha256_duplicado_otro_expediente:
		"El mismo archivo ya fue utilizado en otra oportunidad",
	identificador_duplicado_otro_lead:
		"El mismo identificador aparece en otro lead",
	sha256_duplicado_mismo_expediente:
		"El mismo archivo ya existe en este expediente",
	documento_declarado_sintetico_o_sin_validez:
		"El documento se identifica como sintético o sin validez",
	ia_no_disponible: "La inspección visual con IA no estuvo disponible",
	inspeccion_tecnica_incompleta:
		"La inspección técnica del PDF no pudo completarse",
	tipo_documento_incierto:
		"No se pudo confirmar que el archivo sea un estado de cuenta",
	identidad_comparada: "El titular coincide con una persona del expediente",
};

export function makeSignal(
	code: string,
	weight: number,
	severity: Signal["severity"],
	source: Signal["source"],
	partial: Partial<
		Omit<Signal, "code" | "weight" | "severity" | "source" | "label">
	> = {},
): Signal {
	return {
		code,
		label: SIGNAL_LABELS[code] ?? code.replaceAll("_", " "),
		weight: SIGNAL_WEIGHTS[code] ?? weight,
		severity,
		source,
		...partial,
	};
}

export function applyRuleset(params: {
	signals: Signal[];
	llm?: DocumentIntegrityAiResult | null;
	invalidPdfHeader?: boolean;
	corruptPdf?: boolean;
	pipelineError?: string | null;
}): ValidationOutcome {
	const { signals, llm } = params;
	if (params.pipelineError) {
		return { result: "error", score: 0, reason: params.pipelineError, signals };
	}

	if (params.invalidPdfHeader || params.corruptPdf) {
		return {
			result: "rechazado",
			score: 0,
			reason:
				"El PDF está dañado o su formato no es válido. Vuelve a cargar una copia válida del estado de cuenta.",
			signals,
		};
	}

	if (
		!llm ||
		signals.some((signal) =>
			[
				"ia_no_disponible",
				"pdf_protegido_no_abre",
				"inspeccion_tecnica_incompleta",
			].includes(signal.code),
		)
	) {
		return {
			result: "error",
			score: 0,
			reason:
				"No se pudo completar la inspección documental. Intenta nuevamente con un PDF que pueda inspeccionarse.",
			signals,
		};
	}

	if (
		llm?.corresponde_al_tipo_declarado === false &&
		llm.confianza_tipo_documento >= MIN_DOCUMENT_TYPE_REJECTION_CONFIDENCE
	) {
		const detected = llm?.tipo_documento_detectado || "archivo no reconocible";
		return {
			result: "rechazado",
			score: 0,
			reason: `El archivo cargado no es un estado de cuenta bancario (se detectó: ${detected}). Vuelve a cargar el documento correcto.`,
			signals,
		};
	}
	const evaluatedSignals =
		llm &&
		(llm.corresponde_al_tipo_declarado === false ||
			llm.confianza_tipo_documento < MIN_DOCUMENT_TYPE_REJECTION_CONFIDENCE)
			? [
					...signals,
					makeSignal("tipo_documento_incierto", 0, "media", "ia", {
						confidence: llm.confianza_tipo_documento,
						evidence: { detected: llm.tipo_documento_detectado },
					}),
				]
			: [...signals];
	if (
		llm?.es_legible === false &&
		!signals.some(
			(signal) =>
				signal.code === "documento_declarado_sintetico_o_sin_validez" &&
				isRejectionEligibleSignal(signal),
		)
	)
		evaluatedSignals.push(
			makeSignal("captura_con_legibilidad_insuficiente", 0, "media", "ia"),
		);

	const calculateScore = (scoredSignals: Signal[]) => {
		const deterministicScore = scoredSignals
			.filter((signal) => signal.source !== "ia")
			.reduce((sum, signal) => sum + Math.max(0, signal.weight), 0);
		const aiScore = Math.min(
			scoredSignals
				.filter((signal) => signal.source === "ia")
				.reduce((sum, signal) => sum + Math.max(0, signal.weight), 0),
			LLM_WEIGHT_CAP,
		);
		return Math.max(0, deterministicScore + aiScore);
	};
	const score = calculateScore(evaluatedSignals);
	// El score se conserva como evidencia; no determina el veredicto.
	const result = evaluatedSignals.some(isRejectionEligibleSignal)
		? "rechazado"
		: "valido";
	const reason =
		result === "valido"
			? score > 0 || llm.es_legible === false
				? "El documento puede continuar con las alertas informativas indicadas."
				: "No se detectaron señales de alteración."
			: "El documento se identifica explícitamente como sintético, de prueba o sin validez. Solicita un estado de cuenta válido.";

	return { result, score, reason, signals: evaluatedSignals };
}
