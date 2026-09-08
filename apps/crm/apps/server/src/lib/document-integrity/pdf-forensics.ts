import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
	PDFRef,
} from "pdf-lib";

export const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
// Cooperativo: se consulta entre etapas. PDFDocument.load() corre antes del
// primer chequeo y puede excederlo.
export const PARSE_BUDGET_MS = 8_000;

// Techo pesimista por documento para dimensionar esperas. inspectPdf no lo
// impone.
export const MAX_PDF_PARSE_LEASE_MS = 15_000;
export const MAX_DECOMPRESSED_PDF_CONTENT_BYTES = 32 * 1024 * 1024;
// Techo de objetos declarados en el trailer. Un /Size disparatado hace que
// pdf-lib reserve estructuras enormes durante load().
export const MAX_DECLARED_PDF_OBJECTS = 500_000;

export interface PdfByteScan {
	hasPdfHeader: boolean;
	eofCount: number;
	startxrefCount: number;
	prevCount: number;
	hasXref: boolean;
	isEncrypted: boolean;
	isLinearized: boolean;
	isSigned: boolean;
	xmpRaw: string | null;
	sha256: string;
}

export interface PdfMetadata {
	producer: string | null;
	creator: string | null;
	creationDate: Date | null;
	modificationDate: Date | null;
}

export interface XmpMetadata {
	producer: string | null;
	creatorTool: string | null;
	createDate: Date | null;
	modifyDate: Date | null;
	savedActions: number;
}

export interface FontClassification {
	names: string[];
	duplicateSubsets: string[];
	nonEmbedded: string[];
	type3: string[];
}

export interface PageContentClassification {
	page: number;
	hasText: boolean;
	hasImage: boolean;
}

export interface PdfForensicsResult {
	bytes: PdfByteScan;
	metadata: PdfMetadata | null;
	xmp: XmpMetadata | null;
	pageCount: number | null;
	fonts: FontClassification | null;
	pages: PageContentClassification[];
	parseError: string | null;
	protectedPdf: boolean;
	budgetExceeded: boolean;
	degradedToL0: boolean;
}

function countMatches(text: string, pattern: RegExp): number {
	return text.match(pattern)?.length ?? 0;
}

function extractRawXmp(text: string): string | null {
	const start = text.search(/<x:xmpmeta\b|<rdf:RDF\b/i);
	if (start < 0) return null;
	const xmpEnd = text.search(/<\/x:xmpmeta>/i);
	if (xmpEnd >= start) return text.slice(start, xmpEnd + "</x:xmpmeta>".length);
	const rdfEnd = text.search(/<\/rdf:RDF>/i);
	return rdfEnd >= start
		? text.slice(start, rdfEnd + "</rdf:RDF>".length)
		: null;
}

export function scanPdfBytes(buffer: Buffer | Uint8Array): PdfByteScan {
	const bytes = Buffer.from(buffer);
	const text = bytes.toString("latin1");
	return {
		hasPdfHeader:
			bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "%PDF",
		eofCount: countMatches(text, /%%EOF/g),
		startxrefCount: countMatches(text, /startxref/g),
		prevCount: countMatches(text, /\/Prev\b/g),
		hasXref: /(?:\bxref\b|\/Type\s*\/XRef\b)/.test(text),
		isEncrypted: /\/Encrypt\b/.test(text),
		isLinearized: /\/Linearized\b/.test(text),
		isSigned: /\/Sig\b/.test(text) && /\/ByteRange\s*\[/.test(text),
		xmpRaw: extractRawXmp(text),
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

function xmlValue(xml: string, names: string[]): string | null {
	for (const name of names) {
		const escaped = name.replace(":", "\\:");
		const attribute = xml.match(new RegExp(`${escaped}=["']([^"']+)["']`, "i"));
		if (attribute?.[1]) return attribute[1].trim();
		const element = xml.match(
			new RegExp(`<${escaped}[^>]*>([^<]+)</${escaped}>`, "i"),
		);
		if (element?.[1]) return element[1].trim();
	}
	return null;
}

function parseDate(value: string | null): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseXmpMetadata(raw: string | null): XmpMetadata | null {
	if (!raw) return null;
	return {
		producer: xmlValue(raw, ["pdf:Producer"]),
		creatorTool: xmlValue(raw, ["xmp:CreatorTool"]),
		createDate: parseDate(xmlValue(raw, ["xmp:CreateDate"])),
		modifyDate: parseDate(
			xmlValue(raw, ["xmp:ModifyDate", "xmp:MetadataDate"]),
		),
		savedActions: countMatches(
			raw,
			/stEvt:action=["']saved["']|<stEvt:action>saved<\/stEvt:action>/gi,
		),
	};
}

export type ProducerClassification =
	| "editor"
	| "navegador_ofimatica"
	| "otro"
	| "ausente";

export function classifyProducer(
	producer: string | null | undefined,
): ProducerClassification {
	if (!producer?.trim()) return "ausente";
	if (
		/acrobat|photoshop|illustrator|foxit|nitro|sejda|ilovepdf|smallpdf/i.test(
			producer,
		)
	) {
		return "editor";
	}
	if (
		/skia\/pdf|microsoft.*word|libreoffice|wkhtmltopdf|puppeteer/i.test(
			producer,
		)
	) {
		return "navegador_ofimatica";
	}
	return "otro";
}

export function classifyFonts(
	fonts: Array<{ name: string; embedded: boolean; subtype: string | null }>,
): FontClassification {
	const subsetFamilies = new Map<string, Set<string>>();
	for (const font of fonts) {
		const match = font.name.match(/^([A-Z]{6})\+(.+)$/);
		if (!match) continue;
		const prefixes = subsetFamilies.get(match[2]) ?? new Set<string>();
		prefixes.add(match[1]);
		subsetFamilies.set(match[2], prefixes);
	}

	return {
		names: [...new Set(fonts.map((font) => font.name))].sort(),
		duplicateSubsets: [...subsetFamilies.entries()]
			.filter(([, prefixes]) => prefixes.size > 1)
			.map(([family]) => family)
			.sort(),
		nonEmbedded: [
			...new Set(
				fonts.filter((font) => !font.embedded).map((font) => font.name),
			),
		].sort(),
		type3: [
			...new Set(
				fonts
					.filter((font) => font.subtype === "Type3")
					.map((font) => font.name),
			),
		].sort(),
	};
}

function pdfName(value: unknown): string | null {
	if (!(value instanceof PDFName)) return null;
	return value.asString().replace(/^\//, "");
}

class PdfContentBudgetExceededError extends Error {
	constructor() {
		super("El contenido descomprimido del PDF excede el límite de inspección");
		this.name = "PdfContentBudgetExceededError";
	}
}

interface PdfContentBudget {
	remainingBytes: number;
}

function consumeContentBudget(budget: PdfContentBudget, size: number) {
	if (size > budget.remainingBytes) throw new PdfContentBudgetExceededError();
	budget.remainingBytes -= size;
}

export function inflatePdfStreamBounded(
	raw: Buffer | Uint8Array,
	maxOutputBytes: number,
): Buffer {
	if (maxOutputBytes <= 0) throw new PdfContentBudgetExceededError();
	try {
		return inflateSync(raw, { maxOutputLength: maxOutputBytes });
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ERR_BUFFER_TOO_LARGE"
		)
			throw new PdfContentBudgetExceededError();
		throw error;
	}
}

function decodeStream(stream: PDFRawStream, budget: PdfContentBudget): string {
	const raw = Buffer.from(stream.contents);
	const filter = stream.dict.get(PDFName.of("Filter"));
	const filters =
		filter instanceof PDFArray
			? filter.asArray().map(pdfName).filter(Boolean)
			: [pdfName(filter)].filter(Boolean);
	if (filters.length === 0) {
		consumeContentBudget(budget, raw.length);
		return raw.toString("latin1");
	}
	if (filters.length === 1 && filters[0] === "FlateDecode") {
		const inflated = inflatePdfStreamBounded(raw, budget.remainingBytes);
		consumeContentBudget(budget, inflated.length);
		return inflated.toString("latin1");
	}
	return "";
}

function inspectFontDicts(document: PDFDocument): FontClassification {
	const fonts: Array<{
		name: string;
		embedded: boolean;
		subtype: string | null;
	}> = [];
	for (const [, object] of document.context.enumerateIndirectObjects()) {
		if (
			!(object instanceof PDFDict) ||
			pdfName(object.get(PDFName.of("Type"))) !== "Font"
		)
			continue;
		const baseFont =
			pdfName(object.get(PDFName.of("BaseFont"))) ?? "sin_nombre";
		const subtype = pdfName(object.get(PDFName.of("Subtype")));
		const descriptorRef = object.get(PDFName.of("FontDescriptor"));
		const descriptor = descriptorRef
			? document.context.lookup(descriptorRef, PDFDict)
			: undefined;
		const embedded =
			!!descriptor &&
			["FontFile", "FontFile2", "FontFile3"].some((key) =>
				descriptor.has(PDFName.of(key)),
			);
		fonts.push({ name: baseFont, embedded, subtype });
	}
	return classifyFonts(fonts);
}

function inspectPageContent(
	document: PDFDocument,
): PageContentClassification[] {
	const budget: PdfContentBudget = {
		remainingBytes: MAX_DECOMPRESSED_PDF_CONTENT_BYTES,
	};
	const inspectOperators = (
		operators: string,
		resources: PDFDict | undefined,
		visitedForms: Set<PDFRawStream>,
	): Pick<PageContentClassification, "hasText" | "hasImage"> => {
		let hasText = /\bBT\b[\s\S]*?\bET\b/.test(operators);
		let hasImage = false;
		const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
		if (!xObjects) return { hasText, hasImage };

		const invokedNames = operators.matchAll(/\/([A-Za-z0-9_.-]+)\s+Do\b/g);
		for (const match of invokedNames) {
			const value = xObjects.get(PDFName.of(match[1]));
			const object =
				value instanceof PDFRef ? document.context.lookup(value) : value;
			if (!(object instanceof PDFRawStream)) continue;

			const subtype = pdfName(object.dict.get(PDFName.of("Subtype")));
			if (subtype === "Image") {
				hasImage = true;
				continue;
			}
			if (subtype !== "Form" || visitedForms.has(object)) continue;

			visitedForms.add(object);
			let formOperators = "";
			try {
				formOperators = decodeStream(object, budget);
			} catch (error) {
				if (error instanceof PdfContentBudgetExceededError) throw error;
				continue;
			}
			const formResources =
				object.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ?? resources;
			const formContent = inspectOperators(
				formOperators,
				formResources,
				visitedForms,
			);
			hasText ||= formContent.hasText;
			hasImage ||= formContent.hasImage;
		}
		return { hasText, hasImage };
	};

	return document.getPages().map((page, index) => {
		const contents = page.node.get(PDFName.of("Contents"));
		const refs =
			contents instanceof PDFArray
				? contents.asArray()
				: contents
					? [contents]
					: [];
		let operators = "";
		for (const ref of refs) {
			const stream = ref instanceof PDFRef ? document.context.lookup(ref) : ref;
			if (stream instanceof PDFRawStream)
				operators += `\n${decodeStream(stream, budget)}`;
		}
		const classification = inspectOperators(
			operators,
			page.node.Resources(),
			new Set(),
		);
		return {
			page: index + 1,
			...classification,
		};
	});
}

function safeDocumentMetadata(document: PDFDocument): PdfMetadata {
	return {
		producer: document.getProducer() || null,
		creator: document.getCreator() || null,
		creationDate: document.getCreationDate() ?? null,
		modificationDate: document.getModificationDate() ?? null,
	};
}

// pdf-lib descomprime los object streams dentro de load(), fuera de nuestro
// presupuesto. Aqui se inflan primero con el inflater acotado: si revientan el
// limite, load() no llega a ejecutarse.
export function isPdfSafeToParse(
	buffer: Buffer | Uint8Array,
	maxDecompressedBytes = MAX_DECOMPRESSED_PDF_CONTENT_BYTES,
): boolean {
	const bytes = Buffer.from(buffer);
	const text = bytes.toString("latin1");

	for (const match of text.matchAll(/\/Size\s+(\d+)/g)) {
		if (Number(match[1]) > MAX_DECLARED_PDF_OBJECTS) return false;
	}

	const budget: PdfContentBudget = { remainingBytes: maxDecompressedBytes };
	const objectStream =
		/\/Type\s*\/ObjStm[\s\S]{0,512}?\/Length\s+(\d+)[\s\S]{0,512}?stream\r?\n/g;
	for (const match of text.matchAll(objectStream)) {
		const declaredLength = Number(match[1]);
		const start = (match.index ?? 0) + match[0].length;
		if (!declaredLength || start + declaredLength > bytes.length) return false;
		try {
			const inflated = inflatePdfStreamBounded(
				bytes.subarray(start, start + declaredLength),
				budget.remainingBytes,
			);
			consumeContentBudget(budget, inflated.length);
		} catch (error) {
			if (error instanceof PdfContentBudgetExceededError) return false;
			// Un stream que no infla no es una bomba; que lo resuelva pdf-lib.
		}
	}
	return true;
}

export async function inspectPdf(
	buffer: Buffer | Uint8Array,
): Promise<PdfForensicsResult> {
	const startedAt = performance.now();
	const bytes = scanPdfBytes(buffer);
	const base: PdfForensicsResult = {
		bytes,
		metadata: null,
		xmp: bytes.isEncrypted ? null : parseXmpMetadata(bytes.xmpRaw),
		pageCount: null,
		fonts: null,
		pages: [],
		parseError: null,
		protectedPdf: false,
		budgetExceeded: false,
		degradedToL0: Buffer.byteLength(buffer) > MAX_PDF_SIZE_BYTES,
	};
	if (base.degradedToL0 || !bytes.hasPdfHeader) return base;
	if (!isPdfSafeToParse(buffer)) {
		base.degradedToL0 = true;
		base.budgetExceeded = true;
		return base;
	}

	let document: PDFDocument;
	try {
		document = await PDFDocument.load(buffer, {
			ignoreEncryption: true,
			updateMetadata: false,
			throwOnInvalidObject: false,
		});
		base.pageCount = document.getPageCount();
	} catch (error) {
		base.parseError = error instanceof Error ? error.message : String(error);
		base.protectedPdf = bytes.isEncrypted;
		return base;
	}

	if (
		base.pageCount > MAX_PDF_PAGES ||
		performance.now() - startedAt > PARSE_BUDGET_MS
	) {
		base.budgetExceeded = performance.now() - startedAt > PARSE_BUDGET_MS;
		base.degradedToL0 = true;
		return base;
	}

	if (!bytes.isEncrypted) {
		try {
			base.metadata = safeDocumentMetadata(document);
		} catch (error) {
			base.parseError = error instanceof Error ? error.message : String(error);
		}
	}

	try {
		base.fonts = inspectFontDicts(document);
	} catch (error) {
		base.parseError ??= error instanceof Error ? error.message : String(error);
	}

	if (performance.now() - startedAt <= PARSE_BUDGET_MS) {
		try {
			base.pages = inspectPageContent(document);
		} catch (error) {
			if (error instanceof PdfContentBudgetExceededError) {
				base.budgetExceeded = true;
				base.degradedToL0 = true;
			} else {
				base.parseError ??=
					error instanceof Error ? error.message : String(error);
			}
		}
	} else {
		base.budgetExceeded = true;
	}

	return base;
}
