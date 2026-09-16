import { describe, expect, test } from "bun:test";
import {
	buildDocumentPositiveChecks,
	buildDocumentRecommendedAction,
} from "./decision-evidence";

const cleanAiResponse = {
	es_legible: true,
	corresponde_al_tipo_declarado: true,
	confianza_tipo_documento: 99,
	emisor_normalizado: "gyt_continental",
	titular_detectado: "FREDERIC ARIEL SOC MORALES",
	observaciones_forenses: [],
};

describe("document integrity decision evidence", () => {
	test("recomienda actuar sobre las paginas con senales determinantes", () => {
		expect(
			buildDocumentRecommendedAction({
				result: "revision_manual",
				signals: [
					{
						code: "titular_no_coincide_fuerte",
						page: 9,
						severity: "alta",
						weight: 6,
						source: "identidad",
					},
					{
						code: "huella_no_coincide_con_emisor",
						page: 9,
						severity: "media",
						weight: 3,
						source: "emisor",
					},
					{
						code: "fuente_no_embebida",
						page: 2,
						severity: "media",
						weight: 0,
						source: "estructura",
					},
				],
			}),
		).toContain("la página 9");
	});

	test("no confirma el tipo documental cuando la confianza es baja", () => {
		const checks = buildDocumentPositiveChecks({
			aiRawResponse: {
				...cleanAiResponse,
				confianza_tipo_documento: 69,
			},
			signals: [],
		});
		expect(checks.map((check) => check.code)).not.toContain(
			"tipo_documento_confirmado",
		);
	});

	test("no inventa una pagina para una alerta del documento completo", () => {
		const recommendation = buildDocumentRecommendedAction({
			result: "rechazado",
			signals: [
				{
					code: "titular_no_coincide_fuerte",
					page: null,
					severity: "alta",
					weight: 6,
					source: "identidad",
				},
			],
		});
		expect(recommendation).toContain("estado de cuenta válido");
		expect(recommendation).not.toContain("página");
	});

	test("un rechazo recomienda reemplazar solo las páginas determinantes", () => {
		const recommendation = buildDocumentRecommendedAction({
			result: "rechazado",
			signals: [
				{
					code: "formato_no_corresponde_al_emisor",
					page: 9,
					severity: "alta",
					weight: 4,
					source: "ia",
					confidence: 90,
				},
				{
					code: "logo_baja_calidad",
					page: 2,
					severity: "baja",
					weight: 1,
					source: "ia",
					confidence: 20,
				},
			],
		});
		expect(recommendation).toContain("la página 9");
		expect(recommendation).not.toContain("página 2");
		expect(recommendation).toContain("nueva validación documental");
	});

	test("explica con comprobaciones positivas por qué un documento está válido", () => {
		const checks = buildDocumentPositiveChecks({
			aiRawResponse: cleanAiResponse,
			signals: [
				{
					code: "identidad_comparada",
					source: "identidad",
					weight: 0,
				},
			],
		});
		expect(checks.map((check) => check.code)).toEqual([
			"documento_legible",
			"tipo_documento_confirmado",
			"emisor_identificado",
			"titular_coincide",
			"sin_anomalias_visuales",
			"estructura_sin_alertas",
		]);
	});

	test("no afirma coincidencia si no había personas contra las cuales comparar", () => {
		const checks = buildDocumentPositiveChecks({
			aiRawResponse: cleanAiResponse,
			signals: [],
		});
		expect(checks.map((check) => check.code)).not.toContain("titular_coincide");
	});

	test("no afirma estructura limpia cuando la inspección fue degradada", () => {
		const checks = buildDocumentPositiveChecks({
			aiRawResponse: cleanAiResponse,
			signals: [
				{
					code: "inspeccion_tecnica_incompleta",
					source: "estructura",
					weight: 0,
				},
			],
		});
		expect(checks.map((check) => check.code)).not.toContain(
			"estructura_sin_alertas",
		);
	});

	test("no afirma coincidencia ni estructura limpia si existen alertas", () => {
		const checks = buildDocumentPositiveChecks({
			aiRawResponse: cleanAiResponse,
			signals: [
				{
					code: "titular_no_coincide_fuerte",
					source: "identidad",
					weight: 6,
				},
				{
					code: "productor_es_editor",
					source: "estructura",
					weight: 7,
				},
			],
		});
		expect(checks.map((check) => check.code)).not.toContain("titular_coincide");
		expect(checks.map((check) => check.code)).not.toContain(
			"estructura_sin_alertas",
		);
	});
});
