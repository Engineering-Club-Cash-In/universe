import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import {
	classifyFonts,
	inflatePdfStreamBounded,
	inspectPdf,
	isPdfSafeToParse,
	MAX_DECOMPRESSED_PDF_CONTENT_BYTES,
	parseXmpMetadata,
	scanPdfBytes,
	scanPdfContentOperators,
} from "./pdf-forensics";

describe("PDF forensics", () => {
	test("limita el contenido técnico descomprimido a 16 MB", () => {
		expect(MAX_DECOMPRESSED_PDF_CONTENT_BYTES).toBe(16 * 1024 * 1024);
	});

	test("escanea operadores adversariales en tiempo lineal", () => {
		const operators = `${"BT ".repeat(350_000)}/Im0 Do`;
		const startedAt = performance.now();
		const result = scanPdfContentOperators(operators);

		expect(result).toEqual({
			hasText: false,
			hasInlineImage: false,
			invokedXObjects: ["Im0"],
		});
		expect(performance.now() - startedAt).toBeLessThan(1_000);
	});

	test("solo reconoce operadores reales fuera de textos y comentarios", () => {
		const result = scanPdfContentOperators(
			"(BT ET /Falsa Do) Tj % BT ET /Comentada Do\n<4254204554> Tj ET BT /Real Do ET",
		);

		expect(result).toEqual({
			hasText: true,
			hasInlineImage: false,
			invokedXObjects: ["Real"],
		});
	});

	test("ignora operadores aparentes dentro de imágenes inline", () => {
		const result = scanPdfContentOperators(
			"BI /W 1 /H 1 ID datos BT ET /Falsa Do \nEI\n/Real Do",
		);

		expect(result).toEqual({
			hasText: false,
			hasInlineImage: true,
			invokedXObjects: ["Real"],
		});
	});

	test("una bomba de descompresion se detiene antes de PDFDocument.load", async () => {
		const bomb = deflateSync(Buffer.alloc(17 * 1024 * 1024, 0x20));
		const pdf = Buffer.concat([
			Buffer.from(
				`%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N 5 /First 4 /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`,
				"latin1",
			),
			bomb,
			Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
		]);
		// El archivo cabe en el limite de subida pero inflaria 200 MB.
		expect(pdf.length).toBeLessThan(15 * 1024 * 1024);
		expect(isPdfSafeToParse(pdf)).toBe(false);
		await expect(inspectPdf(pdf)).rejects.toThrow(
			"estructura demasiado pesada para procesarse de forma segura",
		);
	});

	test("detecta object streams con claves reordenadas y longitud indirecta", () => {
		const bomb = deflateSync(Buffer.alloc(40 * 1024 * 1024, 0x20));
		const pdf = Buffer.concat([
			Buffer.from(
				"%PDF-1.7\n1 0 obj\n<< /Length 2 0 R /Filter /FlateDecode /First 4 /N 5 /Type /ObjStm >>\nstream\n",
				"latin1",
			),
			bomb,
			Buffer.from(
				`\nendstream\nendobj\n2 0 obj\n${bomb.length}\nendobj\n%%EOF`,
				"latin1",
			),
		]);

		expect(isPdfSafeToParse(pdf)).toBe(false);
	});

	test("acepta un object stream acotado con longitud indirecta", () => {
		const compressed = deflateSync(Buffer.from("2 0 null", "latin1"));
		const pdf = Buffer.concat([
			Buffer.from(
				"%PDF-1.7\n1 0 obj\n<< /Length 2 0 R /Filter /FlateDecode /First 4 /N 1 /Type /ObjStm >>\nstream\n",
				"latin1",
			),
			compressed,
			Buffer.from(
				`\nendstream\nendobj\n2 0 obj\n${compressed.length}\nendobj\n%%EOF`,
				"latin1",
			),
		]);

		expect(isPdfSafeToParse(pdf)).toBe(true);
	});

	test("resuelve un tipo ObjStm indirecto antes de cargar el PDF", () => {
		const bomb = deflateSync(Buffer.alloc(40 * 1024 * 1024, 0x20));
		const pdf = Buffer.concat([
			Buffer.from(
				`%PDF-1.7\n1 0 obj\n<< /Length ${bomb.length} /Filter /FlateDecode /First 4 /N 5 /Type 3 0 R >>\nstream\n`,
				"latin1",
			),
			bomb,
			Buffer.from(
				"\nendstream\nendobj\n3 0 obj\n/ObjStm\nendobj\n%%EOF",
				"latin1",
			),
		]);

		expect(isPdfSafeToParse(pdf)).toBe(false);
	});

	test("aplica el último Type duplicado como pdf-lib", () => {
		const bomb = deflateSync(Buffer.alloc(40 * 1024 * 1024, 0x20));
		const pdf = Buffer.concat([
			Buffer.from(
				`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Length ${bomb.length} /Filter /FlateDecode /First 4 /N 5 /Type /ObjStm >>\nstream\n`,
				"latin1",
			),
			bomb,
			Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
		]);

		expect(isPdfSafeToParse(pdf)).toBe(false);
	});

	test("también limita streams XRef descomprimidos durante load", () => {
		const bomb = deflateSync(Buffer.alloc(40 * 1024 * 1024, 0));
		const pdf = Buffer.concat([
			Buffer.from(
				`%PDF-1.7\n1 0 obj\n<< /Length ${bomb.length} /Filter /FlateDecode /Size 1 /W [1 2 1] /Type /XRef >>\nstream\n`,
				"latin1",
			),
			bomb,
			Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
		]);

		expect(isPdfSafeToParse(pdf)).toBe(false);
	});

	test("un /Size disparatado en el trailer se rechaza", () => {
		const pdf = Buffer.from(
			"%PDF-1.7\ntrailer\n<< /Size 900000000 >>\n%%EOF",
			"latin1",
		);
		expect(isPdfSafeToParse(pdf)).toBe(false);
	});

	test("un PDF normal pasa la guarda", () => {
		const pdf = Buffer.from(
			"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Size 12 >>\n%%EOF",
			"latin1",
		);
		expect(isPdfSafeToParse(pdf)).toBe(true);
	});

	test("comentarios no falsifican cifrado, linearización ni firma", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const original = Buffer.from(
			await document.save({ useObjectStreams: false }),
		);
		const altered = Buffer.concat([
			original,
			Buffer.from("\n% /Encrypt /Linearized /Sig /ByteRange [0 1 2 3]\n"),
		]);

		expect(scanPdfBytes(altered)).toMatchObject({
			isEncrypted: false,
			isLinearized: false,
			isSigned: false,
		});
		const inspected = await inspectPdf(altered);
		expect(inspected.bytes).toMatchObject({
			isEncrypted: false,
			isLinearized: false,
			isSigned: false,
		});
		expect(inspected.pageCount).toBe(1);
	});

	test("una clave Encrypt inerte en el catálogo no simula cifrado", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		document.catalog.set(PDFName.of("Encrypt"), PDFName.of("Inerte"));
		const inspected = await inspectPdf(
			Buffer.from(await document.save({ useObjectStreams: false })),
		);

		expect(inspected.bytes.isEncrypted).toBe(false);
		expect(inspected.protectedPdf).toBe(false);
	});

	test("solo reconoce Linearized en el diccionario del primer objeto", () => {
		const structural = Buffer.from(
			"%PDF-1.7\n1 0 obj\n<< /Linearized 1 /L 200 >>\nendobj\n%%EOF",
			"latin1",
		);
		const inert = Buffer.from(
			"%PDF-1.7\n% /Linearized 1\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
			"latin1",
		);

		expect(scanPdfBytes(structural).isLinearized).toBe(true);
		expect(scanPdfBytes(inert).isLinearized).toBe(false);
	});

	test("un PDF corrupto no deja de serlo por declarar Encrypt en un comentario", async () => {
		const inspected = await inspectPdf(
			Buffer.from("%PDF-1.7\nxref\n%%EOF\n% /Encrypt\n", "latin1"),
		);

		expect(inspected.bytes.isEncrypted).toBe(false);
		expect(inspected.pageCount).toBeNull();
		expect(inspected.parseError).not.toBeNull();
	});

	test("detecta subsets duplicados y fuentes no embebidas/Type3", () => {
		const result = classifyFonts([
			{ name: "ABCDEF+Arial", embedded: true, subtype: "TrueType" },
			{ name: "GHIJKL+Arial", embedded: true, subtype: "TrueType" },
			{ name: "Courier", embedded: false, subtype: "Type3" },
		]);
		expect(result.duplicateSubsets).toEqual(["Arial"]);
		expect(result.nonEmbedded).toEqual(["Courier"]);
		expect(result.type3).toEqual(["Courier"]);
	});

	test("extrae dos eventos saved del XMP", () => {
		const result = parseXmpMetadata(
			`<x:xmpmeta><rdf:RDF xmp:CreateDate="2026-08-01T00:00:00Z"><stEvt:action>saved</stEvt:action><rdf:li stEvt:action="saved" /></rdf:RDF></x:xmpmeta>`,
		);
		expect(result?.savedActions).toBe(2);
		expect(result?.createDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
	});

	test("clasifica contenido de PDFs generados en memoria", async () => {
		const document = await PDFDocument.create();
		const font = await document.embedFont(StandardFonts.Helvetica);
		document.addPage().drawText("Estado de cuenta de prueba", { font });
		const png = await document.embedPng(
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				"base64",
			),
		);
		document.addPage().drawImage(png, { width: 100, height: 100 });
		const result = await inspectPdf(Buffer.from(await document.save()));
		expect(result.pageCount).toBe(2);
		expect(result.pages[0].hasText).toBe(true);
		expect(result.pages[1].hasImage).toBe(true);
	});

	test("reconoce texto dentro de un Form XObject sin marcarlo como imagen", async () => {
		const source = await PDFDocument.create();
		const sourceFont = await source.embedFont(StandardFonts.Helvetica);
		source.addPage().drawText("Texto dentro de un formulario", {
			font: sourceFont,
		});

		const target = await PDFDocument.create();
		const [embeddedPage] = await target.embedPdf(await source.save(), [0]);
		target.addPage().drawPage(embeddedPage);

		const result = await inspectPdf(Buffer.from(await target.save()));
		expect(result.pages[0]).toMatchObject({ hasText: true, hasImage: false });
	});

	test("limita la expansión de streams Flate altamente comprimibles", () => {
		const compressed = deflateSync(Buffer.alloc(1024 * 1024, 65));
		expect(() => inflatePdfStreamBounded(compressed, 1024)).toThrow(
			"estructura demasiado pesada para procesarse de forma segura",
		);
		expect(inflatePdfStreamBounded(compressed, 1024 * 1024)).toHaveLength(
			1024 * 1024,
		);
	});

	test("un stream de página mayor a 16 MB produce un error técnico", async () => {
		const document = await PDFDocument.create();
		const page = document.addPage();
		const content = document.context.flateStream(
			Buffer.alloc(17 * 1024 * 1024, 0x20),
		);
		page.node.set(PDFName.of("Contents"), document.context.register(content));
		const buffer = Buffer.from(
			await document.save({ useObjectStreams: false }),
		);

		expect(buffer.length).toBeLessThan(15 * 1024 * 1024);
		await expect(inspectPdf(buffer)).rejects.toThrow(
			"estructura demasiado pesada para procesarse de forma segura",
		);
	});
});
