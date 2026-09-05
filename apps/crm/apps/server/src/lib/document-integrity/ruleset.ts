import type {
	DocumentIntegrityAiResult,
	Signal,
	ValidationOutcome,
} from "./types";

export const LLM_WEIGHT_CAP = 8;

export const SIGNAL_WEIGHTS: Record<string, number> = {
	productor_es_editor: 7,
	xmp_historial_de_ediciones: 7,
	creacion_anterior_al_cierre_del_periodo: 0,
	xmp_contradice_info_dict: 6,
	productor_es_navegador_o_ofimatica: 4,
	moddate_posterior_a_creationdate: 3,
	sin_metadata_de_creacion: 1,
	actualizaciones_incrementales: 4,
	una_actualizacion_incremental: 2,
	encrypt_de_emisor_intacto: -2,
	encrypt_ausente_pero_esperado: 3,
	pdf_protegido_no_abre: 0,
	paginas_mixtas_texto_e_imagen: 7,
	todas_las_paginas_rasterizadas: 4,
	fuente_no_embebida: 3,
	fuente_type3: 2,
	huella_coincide_con_emisor: -2,
	huella_no_coincide_con_emisor: 3,
	titular_no_coincide_fuerte: 6,
	titular_no_coincide_parcial: 3,
	sha256_duplicado_otro_expediente: 0,
	identificador_duplicado_otro_lead: 6,
	sha256_duplicado_mismo_expediente: 0,
	ia_no_disponible: 0,
	inspeccion_tecnica_incompleta: 0,
	identidad_comparada: 0,
};

export const SIGNAL_LABELS: Record<string, string> = {
	productor_es_editor: "El productor del PDF es una herramienta de edición",
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
	sha256_duplicado_otro_expediente:
		"El mismo archivo ya fue utilizado en otra oportunidad",
	identificador_duplicado_otro_lead:
		"El mismo identificador aparece en otro lead",
	sha256_duplicado_mismo_expediente:
		"El mismo archivo ya existe en este expediente",
	ia_no_disponible: "La inspección visual con IA no estuvo disponible",
	inspeccion_tecnica_incompleta:
		"La inspección técnica del PDF no pudo completarse",
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

	if (
		params.invalidPdfHeader ||
		params.corruptPdf ||
		llm?.es_legible === false ||
		(llm?.corresponde_al_tipo_declarado === false &&
			llm.confianza_tipo_documento >= 70)
	) {
		if (llm?.es_legible === false) {
			return {
				result: "rechazado",
				score: 0,
				reason:
					"El archivo no se puede leer correctamente. Vuelve a cargar una copia legible del estado de cuenta.",
				signals,
			};
		}
		const detected = llm?.tipo_documento_detectado || "archivo no reconocible";
		return {
			result: "rechazado",
			score: 0,
			reason: `El archivo cargado no es un estado de cuenta bancario (se detectó: ${detected}). Vuelve a cargar el documento correcto.`,
			signals,
		};
	}

	if (params.pipelineError) {
		return { result: "error", score: 0, reason: params.pipelineError, signals };
	}

	const deterministicScore = signals
		.filter((signal) => signal.source !== "ia")
		.reduce((sum, signal) => sum + Math.max(0, signal.weight), 0);
	const aiScore = Math.min(
		signals
			.filter((signal) => signal.source === "ia")
			.reduce((sum, signal) => sum + Math.max(0, signal.weight), 0),
		LLM_WEIGHT_CAP,
	);
	const score = Math.max(0, deterministicScore + aiScore);
	const requiresManual = signals.some((signal) =>
		[
			"ia_no_disponible",
			"pdf_protegido_no_abre",
			"inspeccion_tecnica_incompleta",
		].includes(signal.code),
	);

	const result = requiresManual
		? "revision_manual"
		: score === 0
			? "valido"
			: score <= 3
				? "observacion"
				: "revision_manual";
	const reason =
		result === "valido"
			? "No se detectaron señales de alteración."
			: result === "observacion"
				? "Se detectaron observaciones menores que conviene verificar."
				: "Se detectaron señales que requieren revisión humana.";

	return { result, score, reason, signals };
}
