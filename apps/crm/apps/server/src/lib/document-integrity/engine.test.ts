import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { runDocumentIntegrityEngine } from "./engine";
import type { DocumentIntegrityAiResult } from "./types";

const cleanAiResult: DocumentIntegrityAiResult = {
	corresponde_al_tipo_declarado: true,
	confianza_tipo_documento: 99,
	tipo_documento_detectado: "estado de cuenta",
	emisor_normalizado: "gyt_continental",
	periodo: null,
	titular_detectado: "FREDERIC ARIEL SOC MORALES",
	identificador_detectado: null,
	es_legible: true,
	observaciones_forenses: [],
};

describe("document integrity engine", () => {
	test.each([
		["ortografia_en_descripcion_movimiento", "Desfile hpico", "valido", 0],
		["errores_ortograficos", "codigó", "valido", 4],
	] as const)("distingue ortografía en movimientos de texto bancario: %s", async (code, text, expectedResult, expectedScore) => {
		const pdf = await PDFDocument.create();
		pdf.addPage().drawText("Estado de cuenta");
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await pdf.save()),
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
			llm: {
				...cleanAiResult,
				observaciones_forenses: [
					{
						codigo: code,
						pagina: 1,
						descripcion: "Falta ortográfica visible",
						confianza: 99,
						texto_detectado: text,
					},
				],
			},
		});
		expect(result).toMatchObject({
			result: expectedResult,
			score: expectedScore,
		});
		expect(result.signals.find((signal) => signal.code === code)).toMatchObject(
			{ weight: expectedScore, page: 1, evidence: { textoDetectado: text } },
		);
	});
	test.each([
		false,
		true,
	])("detecta una captura con OCR=%s sin penalizar la rasterización", async (ocr) => {
		const pdf = await PDFDocument.create();
		const image = await pdf.embedPng(
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XkAAAAASUVORK5CYII=",
				"base64",
			),
		);
		const page = pdf.addPage();
		page.drawImage(image);
		if (ocr) page.drawText("Capa OCR");
		const buffer = Buffer.from(await pdf.save());
		const llm = { ...cleanAiResult, paginas_fotografiadas_o_escaneadas: [1] };
		const result = await runDocumentIntegrityEngine({
			buffer,
			llm,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});
		expect(result).toMatchObject({ result: "valido", score: 0 });
		expect(
			result.signals.some(
				(signal) => signal.code === "documento_fotografiado_o_escaneado",
			),
		).toBe(true);
		const unreadable = await runDocumentIntegrityEngine({
			buffer,
			llm: { ...llm, es_legible: false },
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});
		expect(unreadable.result).toBe("valido");
		expect(
			unreadable.signals.some(
				(signal) => signal.code === "captura_con_legibilidad_insuficiente",
			),
		).toBe(true);
	});
	test("una página digital sin imagen no se convierte en captura por un índice reportado por IA", async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage().drawText("Documento digital");
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await pdf.save()),
			llm: {
				...cleanAiResult,
				es_legible: false,
				paginas_fotografiadas_o_escaneadas: [1, 99],
			},
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});
		expect(result.result).toBe("valido");
		expect(
			result.signals.some(
				(signal) => signal.code === "documento_fotografiado_o_escaneado",
			),
		).toBe(false);
	});
	test("una diferencia de fuente solo informa sin alterar el veredicto", async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage().drawText("Estado de cuenta");
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await pdf.save()),
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
			llm: {
				...cleanAiResult,
				observaciones_forenses: [
					{
						codigo: "tipografia_inconsistente",
						pagina: 1,
						descripcion: "Una parte del texto tiene mayor grosor",
						confianza: 99,
						texto_detectado: null,
					},
				],
			},
		});
		expect(result.result).toBe("valido");
		expect(result.score).toBe(0);
		expect(
			result.signals.find(
				(signal) => signal.code === "tipografia_inconsistente",
			),
		).toMatchObject({ weight: 0, severity: "baja", page: 1 });
	});
	test("una inspección degradada produce un error técnico", async () => {
		const buffer = Buffer.alloc(20 * 1024 * 1024 + 1);
		buffer.write("%PDF-1.7\n");
		buffer.write("%%EOF", buffer.length - 5);
		const result = await runDocumentIntegrityEngine({
			buffer,
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.result).toBe("error");
		expect(
			result.signals.some(
				(signal) => signal.code === "inspeccion_tecnica_incompleta",
			),
		).toBe(true);
	});

	test("un PDF corrupto no evade el rechazo declarando Encrypt en un comentario", async () => {
		const buffer = Buffer.from(
			[
				"%PDF-1.7",
				"xref",
				"0 1",
				"0000000000 65535 f ",
				"trailer",
				"<< /Size 1 >>",
				"startxref",
				"9",
				"%%EOF",
				"% /Encrypt",
			].join("\n"),
		);
		const result = await runDocumentIntegrityEngine({
			buffer,
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.forensics).toMatchObject({
			pageCount: null,
			protectedPdf: false,
		});
		expect(result.forensics.parseError).not.toBeNull();
		expect(result.forensics.bytes).toMatchObject({
			hasXref: true,
			eofCount: 1,
		});
		expect(result.result).toBe("rechazado");
	});

	// Vectores generados con pypdf: contraseña de usuario vacía o "secreta".
	test.each([
		[
			"RC4 de 128 bits que abre sin contraseña",
			2,
			3,
			"a80435d1f8a3b357677b267a8ba441c6e629b775a5afe41c0e033edde33fe513",
			"b011b37341cad8ab338a6eab509153d328bf4e5e4e758a4164004e56fffa0108",
			false,
		],
		[
			"RC4 de 128 bits que pide contraseña",
			2,
			3,
			"f3de18fdd3a2583ebc35366201d401aac849e13c8fc6d2b20f0f21f3ef520c46",
			"82538ef8c23140159bcb21a593fe3c3428bf4e5e4e758a4164004e56fffa0108",
			true,
		],
		[
			"AES de 256 bits que abre sin contraseña",
			5,
			6,
			"240e5f756786ca886e5cf4c8e7d9731956f44800b21651f69fe50d45c21cd64f23e76138806b6943c053a8dec6227702",
			"dda3ee6e6366cbfed0043fef6daedfbfe7632340b9cbfe1a559f63d4035409fbecfa640123dd906678753a072f7a732f",
			false,
		],
		[
			"AES de 256 bits que pide contraseña",
			5,
			6,
			"f725b4c0e11561b95ca3cf04785b97b500ff589fde4f7f36d49295522925d1d2d6448ea273bedede2b7c909b6c267a70",
			"172a161dd05857145aafaba22dcbb2aafd82c5f75e3c9bc3cdf5408c467926acd695a8c5d382647b27ea450bf2520f1a",
			true,
		],
	] as const)("un PDF cifrado con %s", async (_, version, revision, owner, user, requiresPassword) => {
		const document = await PDFDocument.create();
		document.addPage();
		const { context } = document;
		context.trailerInfo.Encrypt = context.register(
			context.obj({
				Filter: "Standard",
				V: version,
				R: revision,
				Length: version === 2 ? 128 : 256,
				P: -3904,
				O: PDFHexString.of(owner),
				U: PDFHexString.of(user),
			}),
		);
		const id = PDFHexString.of(
			"3539633230626261656338326531623563363363616265663561666165663131",
		);
		context.trailerInfo.ID = context.obj([id, id]);

		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save({ useObjectStreams: false })),
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.forensics).toMatchObject({
			protectedPdf: requiresPassword,
			restrictedPdf: !requiresPassword,
		});
		expect(result.result).toBe(requiresPassword ? "rechazado" : "valido");
		expect(result.signals.map((signal) => signal.code)).toContain(
			requiresPassword
				? "pdf_protegido_no_abre"
				: "pdf_con_restricciones_del_emisor",
		);
	});

	test("tokens estructurales en comentarios no limpian señales deterministas", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		document.setProducer("Microsoft Word for Microsoft 365");
		document.setCreationDate(new Date("2026-08-01T12:00:00Z"));
		document.setModificationDate(new Date("2026-08-05T12:00:00Z"));
		const original = Buffer.from(
			await document.save({ useObjectStreams: false }),
		);
		const altered = Buffer.concat([
			original,
			Buffer.from("\n% /Encrypt /Linearized /Sig /ByteRange [0 1 2 3]\n"),
		]);

		const [baseline, adversarial] = await Promise.all(
			[original, altered].map((buffer) =>
				runDocumentIntegrityEngine({
					buffer,
					llm: cleanAiResult,
					registeredNames: ["FREDERIC ARIEL SOC MORALES"],
				}),
			),
		);

		expect(adversarial.result).toBe(baseline.result);
		expect(adversarial.score).toBe(baseline.score);
		expect(adversarial.signals.map((signal) => signal.code)).toEqual(
			baseline.signals.map((signal) => signal.code),
		);
		expect(adversarial.result).toBe("valido");
	});

	test("una fecha extraída por IA nunca fuerza revisión manual", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		document.setCreationDate(new Date("2026-06-30T12:00:00Z"));
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: {
				...cleanAiResult,
				periodo: { inicio: "2026-07-01", fin: "2026-07-31" },
			},
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});
		const dateSignal = result.signals.find(
			(signal) => signal.code === "creacion_anterior_al_cierre_del_periodo",
		);

		expect(dateSignal).toMatchObject({ weight: 0, source: "ia" });
		expect(result.result).toBe("valido");
		expect(result.result).not.toBe("rechazado");
	});

	test("una leyenda sintética explícita y confiable rechaza el documento", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: {
				...cleanAiResult,
				observaciones_forenses: [
					{
						codigo: "documento_declarado_sintetico_o_sin_validez",
						pagina: 1,
						descripcion:
							"El encabezado declara que se trata de una muestra sintética.",
						confianza: 98,
						texto_detectado: "MUESTRA SINTÉTICA",
					},
				],
			},
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.result).toBe("rechazado");
		expect(result.score).toBeGreaterThanOrEqual(7);
		expect(result.signals).toContainEqual(
			expect.objectContaining({
				code: "documento_declarado_sintetico_o_sin_validez",
				page: 1,
				confidence: 98,
				evidence: { textoDetectado: "MUESTRA SINTÉTICA" },
			}),
		);
	});

	test("una leyenda sintética con página inexistente no provoca rechazo", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: {
				...cleanAiResult,
				observaciones_forenses: [
					{
						codigo: "documento_declarado_sintetico_o_sin_validez",
						pagina: 2,
						descripcion: "La leyenda aparece en una página inexistente.",
						confianza: 98,
						texto_detectado: "MUESTRA SINTÉTICA",
					},
				],
			},
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.result).toBe("valido");
		expect(
			result.signals.find(
				(signal) =>
					signal.code === "documento_declarado_sintetico_o_sin_validez",
			)?.page,
		).toBeNull();
	});

	test("varios subsets de una fuente no son una señal de alteración por sí solos", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		for (const baseFont of [
			"ABCDEF+Sarabun-Regular",
			"GHIJKL+Sarabun-Regular",
		]) {
			document.context.register(
				document.context.obj({
					Type: PDFName.of("Font"),
					Subtype: PDFName.of("Type1"),
					BaseFont: PDFName.of(baseFont),
				}),
			);
		}

		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.forensics.fonts?.duplicateSubsets).toEqual([
			"Sarabun-Regular",
		]);
		expect(
			result.signals.some(
				(signal) => signal.code === "subsets_duplicados_de_fuente",
			),
		).toBe(false);
	});

	test("procesar un PDF con iLovePDF es informativo si no hay inconsistencias", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		document.setProducer("iLovePDF");
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(
			result.signals.find((signal) => signal.code === "productor_es_editor"),
		).toMatchObject({ weight: 0, severity: "baja" });
		expect(result.result).toBe("valido");
	});

	test("un emisor sin perfil interno no genera una observación", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(
			result.signals.some((signal) => signal.code === "emisor_desconocido"),
		).toBe(false);
	});

	test("un SHA usado en una oportunidad ganada exige revision manual", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
			duplicates: {
				shaInOtherOpportunity: true,
				shaInWonOpportunity: true,
			},
		});

		expect(result.result).toBe("valido");
		expect(
			result.signals.find(
				(signal) => signal.code === "sha256_duplicado_oportunidad_ganada",
			),
		).toMatchObject({ weight: 6, severity: "alta" });
		expect(
			result.signals.some(
				(signal) => signal.code === "sha256_duplicado_otro_expediente",
			),
		).toBe(false);
	});

	test("los demas duplicados se conservan como informativos", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
			duplicates: {
				shaInOtherOpportunity: true,
				identifierInOtherLead: true,
			},
		});

		for (const code of [
			"sha256_duplicado_otro_expediente",
			"identificador_duplicado_otro_lead",
		]) {
			expect(
				result.signals.find((signal) => signal.code === code),
			).toMatchObject({
				weight: 0,
				severity: "baja",
			});
		}
		expect(result.result).toBe("valido");
		expect(result.result).not.toBe("rechazado");
	});
});
