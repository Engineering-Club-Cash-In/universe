import { describe, expect, test } from "bun:test";
import {
	ESTADO_CUENTA_ISSUER_FINGERPRINTS,
	ESTADO_CUENTA_AI_SIGNAL_META,
	ESTADO_CUENTA_PROMPT,
	estadoCuentaBatchAiSchema,
	getIssuerFingerprint,
	normalizeStatementIdentifier,
} from "./estado-cuenta";

describe("estado de cuenta", () => {
	test("el contrato y prompt separan ortografía de movimientos y texto fijo", () => {
		expect(ESTADO_CUENTA_PROMPT).toContain(
			"Reservá errores_ortograficos únicamente para encabezados",
		);
		expect(ESTADO_CUENTA_PROMPT).toContain(
			"No dupliques el mismo hallazgo en ambos códigos",
		);
		expect(
			ESTADO_CUENTA_AI_SIGNAL_META.ortografia_en_descripcion_movimiento,
		).toMatchObject({ weight: 0, severity: "baja" });
		const parsed = estadoCuentaBatchAiSchema.parse({
			documentos: [
				{
					...batchDocument,
					observaciones_forenses: [
						{
							codigo: "ortografia_en_descripcion_movimiento",
							pagina: 1,
							descripcion: "Falta en descripción de un movimiento",
							confianza: 99,
							texto_detectado: "Desfile hpico",
						},
					],
				},
			],
		});
		expect(parsed.documentos[0].observaciones_forenses[0].codigo).toBe(
			"ortografia_en_descripcion_movimiento",
		);
	});
	test("la tipografía es informativa en cualquier parte del documento", () => {
		expect(ESTADO_CUENTA_PROMPT).toContain("En cualquier parte del documento");
		expect(ESTADO_CUENTA_PROMPT).toContain("es únicamente informativa");
		expect(ESTADO_CUENTA_AI_SIGNAL_META.tipografia_inconsistente).toMatchObject(
			{ severity: "baja", weight: 0 },
		);
	});
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
	test("las páginas de captura son opcionales pero deben ser índices válidos", () => {
		expect(
			estadoCuentaBatchAiSchema.parse({ documentos: [batchDocument] })
				.documentos[0].paginas_fotografiadas_o_escaneadas,
		).toEqual([]);
		expect(
			estadoCuentaBatchAiSchema.parse({
				documentos: [
					{ ...batchDocument, paginas_fotografiadas_o_escaneadas: [1, 3] },
				],
			}).documentos[0].paginas_fotografiadas_o_escaneadas,
		).toEqual([1, 3]);
		expect(
			estadoCuentaBatchAiSchema.safeParse({
				documentos: [
					{ ...batchDocument, paginas_fotografiadas_o_escaneadas: [0] },
				],
			}).success,
		).toBe(false);
	});
	test("distingue perspectiva de anomalías y conserva la página de la limitación", () => {
		const result = estadoCuentaBatchAiSchema.parse({
			documentos: [
				{
					...batchDocument,
					observaciones_forenses: [
						{
							codigo: "captura_impide_verificar_alineacion",
							pagina: 3,
							descripcion: "La curvatura del papel impide verificar las filas",
							confianza: 95,
							texto_detectado: null,
						},
					],
				},
			],
		});
		expect(result.documentos[0].observaciones_forenses[0]).toMatchObject({
			codigo: "captura_impide_verificar_alineacion",
			pagina: 3,
		});
		expect(
			ESTADO_CUENTA_AI_SIGNAL_META.captura_impide_verificar_alineacion,
		).toMatchObject({ severity: "baja", weight: 0 });
		expect(ESTADO_CUENTA_PROMPT).toContain(
			"no generes observaciones por esa deformación",
		);
		expect(ESTADO_CUENTA_PROMPT).toContain("desplazado aisladamente");
		expect(ESTADO_CUENTA_PROMPT).toContain(
			"Ser una fotografía no garantiza legitimidad",
		);
	});
	test("conserva la palabra y página de una falta ortográfica sin tratarla como tipografía", () => {
		const result = estadoCuentaBatchAiSchema.parse({
			documentos: [
				{
					...batchDocument,
					observaciones_forenses: [
						{
							codigo: "errores_ortograficos",
							pagina: 1,
							descripcion: "La palabra codigó tiene una tilde incorrecta",
							confianza: 99,
							texto_detectado: "codigó",
						},
					],
				},
			],
		});
		expect(result.documentos[0].observaciones_forenses[0].codigo).toBe(
			"errores_ortograficos",
		);
		expect(result.documentos[0].observaciones_forenses[0].texto_detectado).toBe(
			"codigó",
		);
		expect(result.documentos[0].observaciones_forenses[0].pagina).toBe(1);
		expect(ESTADO_CUENTA_AI_SIGNAL_META.errores_ortograficos).toMatchObject({
			severity: "media",
			weight: 4,
		});
		expect(ESTADO_CUENTA_PROMPT).toContain("no errores lingüísticos");
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
