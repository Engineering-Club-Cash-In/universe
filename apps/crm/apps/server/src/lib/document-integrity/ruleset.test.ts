import { describe, expect, test } from "bun:test";
import {
	applyRuleset,
	LLM_WEIGHT_CAP,
	makeSignal,
	isRejectionEligibleSignal,
	SIGNAL_LABELS,
	SIGNAL_WEIGHTS,
} from "./ruleset";
import type { DocumentIntegrityAiResult, Signal } from "./types";
import { currentValidationResult, currentValidationReason } from "./types";

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
				"tipo_documento_incierto",
				"captura_con_legibilidad_insuficiente",
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
	test.each([
		0, 69, 70, 90, 94, 95, 100,
	])("tipo incorrecto se rechaza solamente con confianza >=95: %s", (confidence) => {
		const result = applyRuleset({
			signals: [],
			llm: {
				...cleanLlm,
				corresponde_al_tipo_declarado: false,
				confianza_tipo_documento: confidence,
				tipo_documento_detectado: "factura",
			},
		});
		expect(result.result).toBe(confidence >= 95 ? "rechazado" : "valido");
		if (confidence < 95)
			expect(
				result.signals.some(
					(signal) => signal.code === "tipo_documento_incierto",
				),
			).toBe(true);
	});
	test("las revisiones y observaciones históricas se habilitan sin reescribir el resultado original", () => {
		for (const result of ["revision_manual", "observacion"] as const) {
			expect(currentValidationResult(result)).toBe(result);
			expect(
				currentValidationReason(result, "Requiere revisión humana"),
			).toContain("Requiere");
		}
		expect(currentValidationResult("error")).toBe("error");
		expect(currentValidationResult("rechazado")).toBe("rechazado");
	});
	test("ni un score muy alto ni la mala legibilidad permiten rechazar sin motivo explícito", () => {
		const signals = [
			makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
			makeSignal("sha256_duplicado_oportunidad_ganada", 6, "alta", "duplicado"),
			makeSignal("xmp_historial_de_ediciones", 7, "alta", "estructura"),
			makeSignal("montos_sobrepuestos", 4, "alta", "ia", { confidence: 99 }),
		];
		const result = applyRuleset({
			signals,
			llm: { ...cleanLlm, es_legible: false },
		});
		expect(result.result).toBe("valido");
		expect(result.score).toBeGreaterThan(7);
		expect(
			result.signals.some(
				(signal) => signal.code === "captura_con_legibilidad_insuficiente",
			),
		).toBe(true);
	});
	test("la ortografía de movimientos no exige revisión ni contribuye al rechazo", () => {
		const typo = makeSignal(
			"ortografia_en_descripcion_movimiento",
			0,
			"baja",
			"ia",
			{
				confidence: 99,
				page: 1,
				evidence: { textoDetectado: "Desfile hpico" },
			},
		);
		expect(applyRuleset({ llm: cleanLlm, signals: [typo] })).toMatchObject({
			result: "valido",
			score: 0,
		});
		expect(isRejectionEligibleSignal(typo)).toBe(false);
		expect(
			applyRuleset({
				llm: cleanLlm,
				signals: [
					typo,
					makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
				],
			}),
		).toMatchObject({ result: "valido", score: 6 });
		expect(
			applyRuleset({
				llm: cleanLlm,
				signals: [
					typo,
					makeSignal("errores_ortograficos", 4, "media", "ia", {
						confidence: 99,
					}),
				],
			}),
		).toMatchObject({ result: "valido", score: 4 });
	});
	test.each([
		"todas_las_paginas_rasterizadas",
		"paginas_mixtas_texto_e_imagen",
		"documento_fotografiado_o_escaneado",
	])("%s no obliga a revisión y protege las dudas de captura", (code) => {
		const capture = makeSignal(code, 0, "baja", "contenido");
		expect(applyRuleset({ signals: [capture], llm: cleanLlm })).toMatchObject({
			result: "valido",
			score: 0,
		});
		expect(
			applyRuleset({
				signals: [capture],
				llm: { ...cleanLlm, es_legible: false },
			}).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [
					capture,
					makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
					makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
				],
				llm: cleanLlm,
			}).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [capture],
				llm: { ...cleanLlm, corresponde_al_tipo_declarado: false },
			}).result,
		).toBe("rechazado");
		expect(
			applyRuleset({ signals: [capture], llm: cleanLlm, corruptPdf: true })
				.result,
		).toBe("rechazado");
		const synthetic = makeSignal(
			"documento_declarado_sintetico_o_sin_validez",
			7,
			"alta",
			"ia",
			{
				confidence: 99,
				page: 1,
				evidence: { textoDetectado: "MUESTRA SINTÉTICA" },
			},
		);
		expect(
			applyRuleset({ signals: [capture, synthetic], llm: cleanLlm }).result,
		).toBe("rechazado");
		expect(
			applyRuleset({
				signals: [capture, synthetic],
				llm: { ...cleanLlm, es_legible: false },
			}).result,
		).toBe("rechazado");
		expect(
			applyRuleset({
				signals: [capture],
				llm: { ...cleanLlm, es_legible: false },
				pipelineError: "R2 no disponible",
			}).result,
		).toBe("error");
	});
	test("el escaneo de Gilson con desalineación y ortografía queda en revisión", () => {
		const result = applyRuleset({
			llm: cleanLlm,
			signals: [
				makeSignal("todas_las_paginas_rasterizadas", 4, "media", "contenido"),
				makeSignal("desalineacion_columnas", 4, "alta", "ia", {
					confidence: 85,
					page: 1,
				}),
				makeSignal("errores_ortograficos", 4, "media", "ia", {
					confidence: 95,
					page: 1,
				}),
				makeSignal("captura_impide_verificar_alineacion", 4, "media", "ia", {
					confidence: 90,
					page: 4,
				}),
			],
		});
		expect(result).toMatchObject({ result: "valido", score: 8 });
	});
	test.each([
		"desalineacion_columnas",
		"montos_sobrepuestos",
		"formato_no_corresponde_al_emisor",
	])("la alerta visual %s no contribuye al rechazo ni siquiera combinada con identidad", (code) => {
		const visual = makeSignal(code, 4, "alta", "ia", { confidence: 99 });
		expect(isRejectionEligibleSignal(visual)).toBe(false);
		expect(
			applyRuleset({
				llm: cleanLlm,
				signals: [
					visual,
					makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
				],
			}).result,
		).toBe("valido");
	});
	test("la tipografía es informativa y no exige revisión ni ayuda al rechazo", () => {
		const typography = makeSignal(
			"tipografia_inconsistente",
			SIGNAL_WEIGHTS.tipografia_inconsistente,
			"baja",
			"ia",
			{
				confidence: 99,
				page: 3,
			},
		);
		const displacement = makeSignal("desalineacion_columnas", 4, "alta", "ia", {
			confidence: 99,
		});
		expect(isRejectionEligibleSignal(typography)).toBe(false);
		expect(
			applyRuleset({ signals: [typography], llm: cleanLlm }),
		).toMatchObject({ result: "valido", score: 0 });
		expect(
			applyRuleset({ signals: [typography, displacement], llm: cleanLlm }),
		).toMatchObject({ result: "valido", score: 4 });
		expect(
			applyRuleset({
				signals: [
					typography,
					makeSignal("xmp_historial_de_ediciones", 7, "alta", "estructura"),
				],
				llm: cleanLlm,
			}).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [
					typography,
					displacement,
					makeSignal("montos_sobrepuestos", 4, "alta", "ia", {
						confidence: 99,
					}),
				],
				llm: cleanLlm,
			}).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [typography],
				llm: { ...cleanLlm, es_legible: false },
			}).result,
		).toBe("valido");
	});
	test("la limitación de alineación es informativa sin exigir revisión", () => {
		const capture = makeSignal(
			"captura_impide_verificar_alineacion",
			0,
			"baja",
			"ia",
			{ confidence: 99, page: 3 },
		);
		const displacement = makeSignal("desalineacion_columnas", 4, "alta", "ia", {
			confidence: 99,
			page: 3,
		});
		expect(applyRuleset({ signals: [capture], llm: cleanLlm }).result).toBe(
			"valido",
		);
		expect(
			applyRuleset({ signals: [capture, displacement], llm: cleanLlm }).result,
		).toBe("valido");
		expect(
			applyRuleset({ signals: [displacement], llm: cleanLlm }).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [
					capture,
					displacement,
					makeSignal("montos_sobrepuestos", 4, "alta", "ia", {
						confidence: 99,
					}),
				],
				llm: cleanLlm,
			}).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [capture],
				llm: { ...cleanLlm, es_legible: false },
			}).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [capture],
				llm: { ...cleanLlm, corresponde_al_tipo_declarado: false },
			}).result,
		).toBe("rechazado");
	});
	test("la ortografía exige revisión pero nunca suma al rechazo", () => {
		const typo = makeSignal("errores_ortograficos", 4, "media", "ia", {
			confidence: 99,
			page: 1,
			evidence: { textoDetectado: "codigó" },
		});
		const format = makeSignal(
			"formato_no_corresponde_al_emisor",
			4,
			"alta",
			"ia",
			{ confidence: 99 },
		);
		expect(applyRuleset({ signals: [typo], llm: cleanLlm }).result).toBe(
			"valido",
		);
		expect(
			applyRuleset({ signals: [typo, format], llm: cleanLlm }).result,
		).toBe("valido");
		expect(
			applyRuleset({
				signals: [
					typo,
					format,
					makeSignal("montos_sobrepuestos", 4, "alta", "ia", {
						confidence: 99,
					}),
				],
				llm: cleanLlm,
			}).result,
		).toBe("valido");
	});
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
		const expected = "valido";
		expect(applyRuleset({ signals: [signal], llm: cleanLlm }).result).toBe(
			expected,
		);
	});

	test("un score alto con identidad distinta conserva alertas sin rechazar", () => {
		const result = applyRuleset({
			signals: [
				makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad"),
				makeSignal("logo_baja_calidad", 1, "baja", "ia", {
					confidence: 90,
				}),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(7);
		expect(result.result).toBe("valido");
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
		expect(result.result).toBe("valido");
	});

	test.each([
		"titular_no_coincide_fuerte",
	])("la señal de identidad %s no sustenta rechazo", (code) => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					code,
					4,
					"alta",
					code === "titular_no_coincide_fuerte" ? "identidad" : "ia",
					{ confidence: 90 },
				),
				makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBeGreaterThanOrEqual(7);
		expect(result.result).toBe("valido");
	});

	test("una señal alta relevante con score menor a siete requiere revisión", () => {
		expect(
			applyRuleset({
				signals: [
					makeSignal("formato_no_corresponde_al_emisor", 4, "alta", "ia", {
						confidence: 90,
					}),
				],
				llm: cleanLlm,
			}).result,
		).toBe("valido");
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
		expect(result.result).toBe("valido");
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
		expect(result.result).toBe("valido");
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
				makeSignal("formato_no_corresponde_al_emisor", 4, "alta", "ia", {
					confidence: 90,
				}),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(10);
		expect(result.result).toBe("valido");
	});

	test("identidad y duplicados combinados conservan alertas sin rechazar", () => {
		const result = applyRuleset({
			signals: [
				makeSignal(
					"sha256_duplicado_oportunidad_ganada",
					6,
					"alta",
					"duplicado",
				),
				makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad", {
					confidence: 90,
				}),
				makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
			],
			llm: cleanLlm,
		});
		expect(result.score).toBe(15);
		expect(result.result).toBe("valido");
	});

	test.each([
		"xmp_historial_de_ediciones",
		"xmp_contradice_info_dict",
	])("la señal alta excluida %s no provoca rechazo por score", (code) => {
		const result = applyRuleset({
			signals: [makeSignal(code, 7, "alta", "estructura")],
			llm: cleanLlm,
		});
		expect(result.score).toBeGreaterThanOrEqual(6);
		expect(result.result).toBe("valido");
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
					confianza_tipo_documento: 95,
				},
			}).result,
		).toBe("rechazado");
		expect(
			applyRuleset({ signals: [], llm: cleanLlm, invalidPdfHeader: true })
				.result,
		).toBe("rechazado");
		expect(
			applyRuleset({ signals: [], llm: cleanLlm, corruptPdf: true }),
		).toMatchObject({
			result: "rechazado",
			reason:
				"El PDF está dañado o su formato no es válido. Vuelve a cargar una copia válida del estado de cuenta.",
		});
	});

	test("un error técnico prevalece sobre un rechazo estructural concurrente", () => {
		const result = applyRuleset({
			signals: [],
			llm: cleanLlm,
			corruptPdf: true,
			pipelineError: "No se pudo descargar el archivo desde R2",
		});

		expect(result).toMatchObject({
			result: "error",
			score: 0,
			reason: "No se pudo descargar el archivo desde R2",
		});
	});

	test("un tipo documental ambiguo requiere revisión manual", () => {
		for (const corresponde of [true, false]) {
			const result = applyRuleset({
				signals: [],
				llm: {
					...cleanLlm,
					corresponde_al_tipo_declarado: corresponde,
					confianza_tipo_documento: 69,
				},
			});
			expect(result.result).toBe("valido");
			expect(result.signals.map((signal) => signal.code)).toContain(
				"tipo_documento_incierto",
			);
		}
	});

	test("señales visuales de baja confianza no provocan rechazo automático", () => {
		const result = applyRuleset({
			llm: cleanLlm,
			signals: [
				makeSignal("desalineacion_columnas", 4, "alta", "ia", {
					confidence: 1,
				}),
				makeSignal("montos_sobrepuestos", 4, "alta", "ia", {
					confidence: 1,
				}),
			],
		});
		expect(result.score).toBe(8);
		expect(result.result).toBe("valido");
	});

	test("una señal confiable no usa otra señal dudosa para alcanzar rechazo", () => {
		const result = applyRuleset({
			llm: cleanLlm,
			signals: [
				makeSignal("desalineacion_columnas", 4, "alta", "ia", {
					confidence: 90,
				}),
				makeSignal("montos_sobrepuestos", 4, "alta", "ia", {
					confidence: 1,
				}),
			],
		});
		expect(result.score).toBe(8);
		expect(result.result).toBe("valido");
	});

	test("dos señales visuales confiables requieren revisión, no rechazo", () => {
		const result = applyRuleset({
			llm: cleanLlm,
			signals: [
				makeSignal("desalineacion_columnas", 4, "alta", "ia", {
					confidence: 90,
				}),
				makeSignal("montos_sobrepuestos", 4, "alta", "ia", {
					confidence: 90,
				}),
			],
		});
		expect(result.score).toBe(8);
		expect(result.result).toBe("valido");
	});

	test("el aporte total del LLM está topado", () => {
		const aiSignals = Array.from({ length: 5 }, (_, index) => ({
			...makeSignal(`ia_${index}`, 4, "alta", "ia"),
		}));
		expect(applyRuleset({ signals: aiSignals, llm: cleanLlm }).score).toBe(
			LLM_WEIGHT_CAP,
		);
	});

	test("un PDF protegido se rechaza y los errores técnicos son reintentables", () => {
		expect(
			applyRuleset({
				signals: [makeSignal("pdf_protegido_no_abre", 0, "alta", "estructura")],
			}).result,
		).toBe("rechazado");

		for (const code of [
			"ia_no_disponible",
			"inspeccion_tecnica_incompleta",
		]) {
			expect(
				applyRuleset({ signals: [makeSignal(code, 0, "alta", "ia")] }).result,
			).toBe("error");
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
		expect(result.score).toBe(0);
		expect(result.result).toBe("error");
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
		expect(result.result).toBe("valido");
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
