import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFName } from "pdf-lib";
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
	test("una inspección degradada requiere revisión manual", async () => {
		const buffer = Buffer.alloc(20 * 1024 * 1024 + 1);
		buffer.write("%PDF-1.7\n");
		buffer.write("%%EOF", buffer.length - 5);
		const result = await runDocumentIntegrityEngine({
			buffer,
			llm: cleanAiResult,
			registeredNames: ["FREDERIC ARIEL SOC MORALES"],
		});

		expect(result.result).toBe("revision_manual");
		expect(
			result.signals.some(
				(signal) => signal.code === "inspeccion_tecnica_incompleta",
			),
		).toBe(true);
	});

	test("un PDF no cifrado que no puede parsearse se rechaza", async () => {
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
		expect(result.result).not.toBe("revision_manual");
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

		expect(result.result).toBe("revision_manual");
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

		expect(result.result).toBe("revision_manual");
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
		expect(result.result).not.toBe("revision_manual");
		expect(result.result).not.toBe("rechazado");
	});
});
