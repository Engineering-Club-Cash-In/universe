import { describe, expect, test } from "bun:test";
import {
	applyRuleset,
	LLM_WEIGHT_CAP,
	makeSignal,
	SIGNAL_LABELS,
	SIGNAL_WEIGHTS,
} from "./ruleset";
import type { DocumentIntegrityAiResult, Signal } from "./types";

const cleanLlm: DocumentIntegrityAiResult = {
	corresponde_al_tipo_declarado: true,
	confianza_tipo_documento: 99,
	tipo_documento_detectado: "estado de cuenta",
	emisor_normalizado: "otro",
	periodo: null,
	titular_detectado: null,
	identificador_detectado: null,
	es_legible: true,
	observaciones_forenses: [],
};

const nonOverrideSignals = Object.entries(SIGNAL_WEIGHTS)
	.filter(
		([code]) =>
			![
				"ia_no_disponible",
				"pdf_protegido_no_abre",
				"inspeccion_tecnica_incompleta",
			].includes(code),
	)
	.map(([code, weight]) =>
		makeSignal(
			code,
			weight,
			weight >= 6 ? "alta" : weight >= 3 ? "media" : "baja",
			"estructura",
		),
	) satisfies Signal[];

describe("document integrity ruleset", () => {
	test("un input limpio es válido sin señales", () => {
		expect(applyRuleset({ signals: [], llm: cleanLlm })).toEqual({
			result: "valido",
			score: 0,
			reason: "No se detectaron señales de alteración.",
			signals: [],
		});
	});

	test.each(
		nonOverrideSignals,
	)("cada señal aislada cae en su banda: $code", (signal) => {
		const expected =
			signal.weight <= 0
				? "valido"
				: signal.weight <= 3
					? "observacion"
					: "revision_manual";
		expect(applyRuleset({ signals: [signal], llm: cleanLlm }).result).toBe(
			expected,
		);
	});

	test("rechaza con score mínimo y una señal alta relevante", () => {
		const result = applyRuleset({
			signals: [
				makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
				makeSignal("logo_baja_calidad", 1, "baja", "ia"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(7);
		expect(result.result).toBe("rechazado");
	});

	test("rechaza un documento que se declara sintético con evidencia completa", () => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					"documento_declarado_sintetico_o_sin_validez",
					7,
					"alta",
					"ia",
					{
						page: 1,
						confidence: 98,
						evidence: { textoDetectado: "MUESTRA SINTÉTICA" },
					},
				),
			],
			llm: cleanLlm,
		});

		expect(result.score).toBe(7);
		expect(result.result).toBe("rechazado");
	});

	test.each([
		{
			name: "sin página",
			partial: {
				confidence: 98,
				evidence: { textoDetectado: "MUESTRA SINTÉTICA" },
			},
		},
		{
			name: "sin leyenda literal",
			partial: { page: 1, confidence: 98 },
		},
		{
			name: "con confianza menor a 90",
			partial: {
				page: 1,
				confidence: 89,
				evidence: { textoDetectado: "MUESTRA SINTÉTICA" },
			},
		},
	])("una declaración sintética $name requiere revisión manual", ({
		partial,
	}) => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					"documento_declarado_sintetico_o_sin_validez",
					7,
					"alta",
					"ia",
					partial,
				),
			],
			llm: cleanLlm,
		});

		expect(result.score).toBe(7);
		expect(result.result).toBe("revision_manual");
	});

	test.each([
		"titular_no_coincide_fuerte",
		"desalineacion_columnas",
		"tipografia_inconsistente",
		"montos_sobrepuestos",
		"formato_no_corresponde_al_emisor",
	])("la señal fuerte habilitada %s puede sustentar un rechazo", (code) => {
		const result = applyRuleset({
			signals: [
				makeSignal(code, 4, "alta", "ia"),
				makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBeGreaterThanOrEqual(7);
		expect(result.result).toBe("rechazado");
	});

	test("una señal alta relevante con score menor a siete requiere revisión", () => {
		expect(
			applyRuleset({
				signals: [
					makeSignal("formato_no_corresponde_al_emisor", 4, "alta", "ia"),
				],
				llm: cleanLlm,
			}).result,
		).toBe("revision_manual");
	});

	test("un score alto sin señales de rechazo requiere revisión manual", () => {
		const result = applyRuleset({
			signals: [
				makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
				makeSignal("una_actualizacion_incremental", 2, "baja", "bytes"),
				makeSignal("titular_no_coincide_parcial", 3, "media", "identidad"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(8);
		expect(result.result).toBe("revision_manual");
	});

	test("un duplicado en oportunidad ganada nunca provoca rechazo automático", () => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					"sha256_duplicado_oportunidad_ganada",
					6,
					"alta",
					"duplicado",
				),
				makeSignal("sin_metadata_de_creacion", 1, "baja", "estructura"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(6);
		expect(result.result).toBe("revision_manual");
	});

	test("el duplicado ganado no ayuda a alcanzar el umbral de rechazo", () => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					"sha256_duplicado_oportunidad_ganada",
					6,
					"alta",
					"duplicado",
				),
				makeSignal("formato_no_corresponde_al_emisor", 4, "alta", "ia"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(10);
		expect(result.result).toBe("revision_manual");
	});

	test("otras señales pueden sustentar el rechazo sin el peso del duplicado ganado", () => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					"sha256_duplicado_oportunidad_ganada",
					6,
					"alta",
					"duplicado",
				),
				makeSignal("formato_no_corresponde_al_emisor", 4, "alta", "ia"),
				makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(13);
		expect(result.result).toBe("rechazado");
	});

	test.each([
		"xmp_historial_de_ediciones",
		"xmp_contradice_info_dict",
		"paginas_mixtas_texto_e_imagen",
	])("la señal alta excluida %s no provoca rechazo por score", (code) => {
		const result = applyRuleset({
			signals: [makeSignal(code, 7, "alta", "estructura")],
			llm: cleanLlm,
		});
		expect(result.score).toBeGreaterThanOrEqual(6);
		expect(result.result).toBe("revision_manual");
	});

	test("una herramienta externa como productor es informativa por sí sola", () => {
		const result = applyRuleset({
			signals: [
				makeSignal("productor_es_editor", 0, "baja", "estructura", {
					evidence: { producer: "iLovePDF" },
				}),
			],
			llm: cleanLlm,
		});

		expect(result.score).toBe(0);
		expect(result.result).toBe("valido");
	});

	test("la ausencia de fecha de creación es informativa por sí sola", () => {
		const result = applyRuleset({
			signals: [
				makeSignal("sin_metadata_de_creacion", 0, "baja", "estructura"),
			],
			llm: cleanLlm,
		});

		expect(result.score).toBe(0);
		expect(result.result).toBe("valido");
	});

	test("los overrides documentales mantienen el rechazo directo", () => {
		expect(
			applyRuleset({
				signals: [],
				llm: {
					...cleanLlm,
					corresponde_al_tipo_declarado: false,
					confianza_tipo_documento: 70,
				},
			}).result,
		).toBe("rechazado");
		expect(
			applyRuleset({ signals: [], llm: cleanLlm, invalidPdfHeader: true })
				.result,
		).toBe("rechazado");
		expect(
			applyRuleset({ signals: [], llm: cleanLlm, corruptPdf: true }).result,
		).toBe("rechazado");
	});

	test("el aporte total del LLM está topado", () => {
		const aiSignals = Array.from({ length: 5 }, (_, index) => ({
			...makeSignal(`ia_${index}`, 4, "alta", "ia"),
		}));
		expect(applyRuleset({ signals: aiSignals, llm: cleanLlm }).score).toBe(
			LLM_WEIGHT_CAP,
		);
	});

	test("una inspección incompleta nunca produce válido", () => {
		for (const code of [
			"ia_no_disponible",
			"pdf_protegido_no_abre",
			"inspeccion_tecnica_incompleta",
		]) {
			expect(
				applyRuleset({ signals: [makeSignal(code, 0, "alta", "ia")] }).result,
			).toBe("revision_manual");
		}
	});

	test("una inspección incompleta prevalece sobre el rechazo por score", () => {
		const result = applyRuleset({
			signals: [
				makeSignal("inspeccion_tecnica_incompleta", 0, "alta", "estructura"),
				makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
				makeSignal("logo_baja_calidad", 1, "baja", "ia"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(7);
		expect(result.result).toBe("revision_manual");
	});

	test("la evidencia favorable no anula señales de riesgo", () => {
		const result = applyRuleset({
			llm: cleanLlm,
			signals: [
				makeSignal("huella_coincide_con_emisor", -2, "baja", "emisor"),
				makeSignal("encrypt_de_emisor_intacto", -2, "baja", "emisor"),
				makeSignal(
					"moddate_posterior_a_creationdate",
					3,
					"media",
					"estructura",
				),
			],
		});
		expect(result.score).toBe(3);
		expect(result.result).toBe("observacion");
	});

	test("una fuente no embebida es informativa por si sola", () => {
		const signal = makeSignal("fuente_no_embebida", 0, "media", "estructura");
		const result = applyRuleset({ signals: [signal], llm: cleanLlm });
		expect(signal.weight).toBe(0);
		expect(result.score).toBe(0);
		expect(result.result).toBe("valido");
	});

	test("reutilizar el mismo archivo en otra oportunidad es informativo", () => {
		const signal = makeSignal(
			"sha256_duplicado_otro_expediente",
			0,
			"baja",
			"duplicado",
		);
		const result = applyRuleset({ signals: [signal], llm: cleanLlm });
		expect(signal.weight).toBe(0);
		expect(signal.severity).toBe("baja");
		expect(result.result).toBe("valido");
		expect(result.score).toBe(0);
	});

	test("toda clave de pesos tiene etiqueta legible en español", () => {
		for (const code of Object.keys(SIGNAL_WEIGHTS)) {
			const label = SIGNAL_LABELS[code];
			expect(label).toBeDefined();
			if (!label) throw new Error(`Falta etiqueta para ${code}`);
			expect(label.length).toBeGreaterThan(5);
			expect(label).not.toBe(code);
		}
	});
});
