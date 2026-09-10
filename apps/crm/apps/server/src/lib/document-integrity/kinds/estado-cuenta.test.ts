import { describe, expect, test } from "bun:test";
import {
	ESTADO_CUENTA_ISSUER_FINGERPRINTS,
	ESTADO_CUENTA_PROMPT,
	estadoCuentaBatchAiSchema,
	getIssuerFingerprint,
	normalizeStatementIdentifier,
} from "./estado-cuenta";

describe("estado de cuenta", () => {
	const batchDocument = {
		document_ref: "document_1",
		corresponde_al_tipo_declarado: true,
		confianza_tipo_documento: 95,
		tipo_documento_detectado: "estado de cuenta",
		emisor_normalizado: "banrural" as const,
		periodo: null,
		titular_detectado: "Persona de prueba",
		identificador_detectado: "123456",
		es_legible: true,
		observaciones_forenses: [],
	};

	test("el contrato batch exige referencias únicas", () => {
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [batchDocument, batchDocument],
			}).success,
		).toBe(false);
		expect(
			estadoCuentaBatchAiSchema.safeParse({ documentos: [batchDocument] })
				.success,
		).toBe(true);
	});

	test("rechaza una respuesta de IA sin veredictos críticos", () => {
		const { es_legible: _legibility, ...withoutLegibility } = batchDocument;
		const {
			corresponde_al_tipo_declarado: _documentType,
			...withoutDocumentType
		} = batchDocument;
		const { confianza_tipo_documento: _confidence, ...withoutConfidence } =
			batchDocument;
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [withoutLegibility],
			}).success,
		).toBe(false);
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [withoutDocumentType],
			}).success,
		).toBe(false);
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [{ ...batchDocument, es_legible: "si" }],
			}).success,
		).toBe(false);
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [withoutConfidence],
			}).success,
		).toBe(false);
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [{ ...batchDocument, confianza_tipo_documento: "alta" }],
			}).success,
		).toBe(false);
	});

	test("conserva la leyenda literal de un documento declarado sintético", () => {
		const parsed = estadoCuentaBatchAiSchema.parse({
			documentos: [
				{
					...batchDocument,
					observaciones_forenses: [
						{
							codigo: "documento_declarado_sintetico_o_sin_validez",
							pagina: 1,
							descripcion: "El documento se identifica como una muestra.",
							confianza: 98,
							texto_detectado: "MUESTRA SINTÉTICA",
						},
					],
				},
			],
		});

		expect(parsed.documentos[0]?.observaciones_forenses[0]).toMatchObject({
			codigo: "documento_declarado_sintetico_o_sin_validez",
			pagina: 1,
			confianza: 98,
			texto_detectado: "MUESTRA SINTÉTICA",
		});
	});

	test("el prompt permite varios estados y emisores legítimos en un PDF unido", () => {
		expect(ESTADO_CUENTA_PROMPT).toContain(
			"varios estados de cuenta legítimos",
		);
		expect(ESTADO_CUENTA_PROMPT).toContain(
			"El cambio de diseño o emisor entre estados completos no es una anomalía",
		);
	});

	test("un emisor desconocido no lanza y no inventa huella", () => {
		expect(ESTADO_CUENTA_ISSUER_FINGERPRINTS).toEqual({});
		expect(getIssuerFingerprint("banco_nuevo")).toBeNull();
		expect(getIssuerFingerprint("otro")).toBeNull();
	});

	test.each([
		[" 0012-3456 7890 ", "001234567890"],
		["GT-AB 1234", "GTAB1234"],
		["12", null],
		[null, null],
	] as const)("normaliza identificador %s", (raw, expected) => {
		expect(normalizeStatementIdentifier(raw)).toBe(expected);
	});
});
