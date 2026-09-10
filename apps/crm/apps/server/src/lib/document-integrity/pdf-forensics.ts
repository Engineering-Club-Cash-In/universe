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
export const MAX_DECOMPRESSED_PDF_CONTENT_BYTES = 16 * 1024 * 1024;
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
		super(
			"El PDF tiene una estructura demasiado pesada para procesarse de forma segura. Solicita una versión optimizada o un archivo nuevo.",
		);
		this.name = "PdfContentBudgetExceededError";
	}
}

class PdfContentTimeBudgetExceededError extends Error {
	constructor() {
		super(
			"El PDF tardó demasiado en procesarse de forma segura. Solicita una versión optimizada o un archivo nuevo.",
		);
		this.name = "PdfContentTimeBudgetExceededError";
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

function assertPdfContentDeadline(deadline: number) {
	if (performance.now() > deadline)
		throw new PdfContentTimeBudgetExceededError();
}

function skipPdfContentLiteralString(
	text: string,
	fromIndex: number,
	deadline: number,
) {
	let depth = 0;
	for (let index = fromIndex; index < text.length; index++) {
		if ((index & 0x3fff) === 0) assertPdfContentDeadline(deadline);
		if (text[index] === "\\") {
			index++;
			continue;
		}
		if (text[index] === "(") depth++;
		if (text[index] === ")" && --depth === 0) return index + 1;
	}
	return text.length;
}

function skipPdfContentHexString(
	text: string,
	fromIndex: number,
	deadline: number,
) {
	for (let index = fromIndex + 1; index < text.length; index++) {
		if ((index & 0x3fff) === 0) assertPdfContentDeadline(deadline);
		if (text[index] === ">") return index + 1;
	}
	return text.length;
}

function skipInlineImageData(
	text: string,
	fromIndex: number,
	deadline: number,
) {
	let index = fromIndex;
	if (text[index] === "\r" && text[index + 1] === "\n") index += 2;
	else if (isPdfWhitespace(text[index])) index++;
	for (; index < text.length - 1; index++) {
		if ((index & 0x3fff) === 0) assertPdfContentDeadline(deadline);
		if (
			text[index] === "E" &&
			text[index + 1] === "I" &&
			isPdfWhitespace(text[index - 1]) &&
			(isPdfWhitespace(text[index + 2]) || !text[index + 2])
		)
			return index + 2;
	}
	return text.length;
}

export function scanPdfContentOperators(
	operators: string,
	deadline = Number.POSITIVE_INFINITY,
): {
	hasText: boolean;
	hasInlineImage: boolean;
	invokedXObjects: string[];
} {
	let index = 0;
	let textObjectOpen = false;
	let hasText = false;
	let hasInlineImage = false;
	let previousName: string | null = null;
	let readingInlineImageDictionary = false;
	const invokedXObjects = new Set<string>();

	while (index < operators.length) {
		if ((index & 0x3fff) === 0) assertPdfContentDeadline(deadline);
		const character = operators[index];
		if (isPdfWhitespace(character)) {
			index++;
			continue;
		}
		if (character === "%") {
			while (
				index < operators.length &&
				operators[index] !== "\n" &&
				operators[index] !== "\r"
			)
				index++;
			continue;
		}
		if (character === "(") {
			index = skipPdfContentLiteralString(operators, index, deadline);
			previousName = null;
			continue;
		}
		if (character === "<" && operators[index + 1] !== "<") {
			index = skipPdfContentHexString(operators, index, deadline);
			previousName = null;
			continue;
		}
		if (character === "/") {
			let end = index + 1;
			while (!isPdfDelimiter(operators[end])) end++;
			previousName = decodeRawPdfName(operators.slice(index + 1, end));
			index = end;
			continue;
		}
		if (isPdfDelimiter(character)) {
			previousName = null;
			index++;
			continue;
		}

		let end = index + 1;
		while (!isPdfDelimiter(operators[end])) end++;
		const token = operators.slice(index, end);
		index = end;

		if (readingInlineImageDictionary) {
			if (token === "ID") {
				index = skipInlineImageData(operators, index, deadline);
				readingInlineImageDictionary = false;
			}
			previousName = null;
			continue;
		}
		if (token === "BI") {
			hasInlineImage = true;
			readingInlineImageDictionary = true;
			previousName = null;
			continue;
		}
		if (token === "BT") {
			textObjectOpen = true;
			previousName = null;
			continue;
		}
		if (token === "ET") {
			if (textObjectOpen) hasText = true;
			textObjectOpen = false;
			previousName = null;
			continue;
		}
		if (token === "Do" && previousName) {
			invokedXObjects.add(previousName);
			previousName = null;
			continue;
		}
		previousName = null;
	}

	return {
		hasText,
		hasInlineImage,
		invokedXObjects: [...invokedXObjects],
	};
}

function inspectPageContent(
	document: PDFDocument,
	deadline: number,
	budget: PdfContentBudget,
): PageContentClassification[] {
	return document.getPages().map((page, index) => {
		const contents = page.node.get(PDFName.of("Contents"));
		const refs =
			contents instanceof PDFArray
				? contents.asArray()
				: contents
					? [contents]
					: [];
		const decodedStreams: string[] = [];
		for (const ref of refs) {
			const stream = ref instanceof PDFRef ? document.context.lookup(ref) : ref;
			if (stream instanceof PDFRawStream)
				decodedStreams.push(decodeStream(stream, budget));
		}

		let hasText = false;
		let hasImage = false;
		const visitedForms = new Set<PDFRawStream>();
		const pendingContent = [
			{
				operators: decodedStreams.join("\n"),
				resources: page.node.Resources(),
			},
		];
		while (pendingContent.length > 0) {
			const content = pendingContent.pop();
			if (!content) break;
			const scanned = scanPdfContentOperators(content.operators, deadline);
			hasText ||= scanned.hasText;
			hasImage ||= scanned.hasInlineImage;

			const xObjects = content.resources?.lookupMaybe(
				PDFName.of("XObject"),
				PDFDict,
			);
			if (!xObjects) continue;
			for (const invokedName of scanned.invokedXObjects) {
				const value = xObjects.get(PDFName.of(invokedName));
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
				try {
					pendingContent.push({
						operators: decodeStream(object, budget),
						resources:
							object.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ??
							content.resources,
					});
				} catch (error) {
					if (error instanceof PdfContentBudgetExceededError) throw error;
				}
			}
		}
		return { page: index + 1, hasText, hasImage };
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

type RawPdfValue =
	| { kind: "name"; value: string }
	| { kind: "number"; value: number }
	| { kind: "ref"; objectNumber: number; generationNumber: number }
	| { kind: "array"; values: RawPdfValue[] }
	| { kind: "other" };

interface RawPdfValueRead {
	value: RawPdfValue;
	nextIndex: number;
}

interface RawPdfObject {
	key: string;
	value?: RawPdfValue;
	dictionary?: { start: number; end: number };
	streamStart?: number;
}

function isPdfDelimiter(character: string | undefined) {
	return (
		!character || isPdfWhitespace(character) || "()<>[]{}/%".includes(character)
	);
}

function isPdfWhitespace(character: string | undefined) {
	if (!character) return false;
	return [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20].includes(character.charCodeAt(0));
}

function skipPdfWhitespaceAndComments(text: string, fromIndex: number) {
	let index = fromIndex;
	while (index < text.length) {
		if (isPdfWhitespace(text[index])) {
			index++;
			continue;
		}
		if (text[index] !== "%") break;
		while (index < text.length && text[index] !== "\n" && text[index] !== "\r")
			index++;
	}
	return index;
}

function skipPdfLiteralString(text: string, fromIndex: number) {
	let depth = 0;
	for (let index = fromIndex; index < text.length; index++) {
		if (text[index] === "\\") {
			index++;
			continue;
		}
		if (text[index] === "(") depth++;
		if (text[index] === ")" && --depth === 0) return index + 1;
	}
	return -1;
}

function findPdfDictionaryEnd(text: string, fromIndex: number) {
	if (text.slice(fromIndex, fromIndex + 2) !== "<<") return -1;
	let depth = 0;
	for (let index = fromIndex; index < text.length; index++) {
		if (text[index] === "%") {
			index = skipPdfWhitespaceAndComments(text, index) - 1;
			continue;
		}
		if (text[index] === "(") {
			const end = skipPdfLiteralString(text, index);
			if (end < 0) return -1;
			index = end - 1;
			continue;
		}
		if (text[index] === "<" && text[index + 1] !== "<") {
			const end = text.indexOf(">", index + 1);
			if (end < 0) return -1;
			index = end;
			continue;
		}
		if (text.slice(index, index + 2) === "<<") {
			depth++;
			index++;
			continue;
		}
		if (text.slice(index, index + 2) === ">>") {
			depth--;
			if (depth === 0) return index + 2;
			index++;
		}
	}
	return -1;
}

function decodeRawPdfName(value: string) {
	return value.replace(/#([0-9a-f]{2})/gi, (_, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);
}

function readRawPdfValue(
	text: string,
	fromIndex: number,
): RawPdfValueRead | null {
	const index = skipPdfWhitespaceAndComments(text, fromIndex);
	const first = text[index];
	if (!first) return null;

	if (first === "/") {
		let end = index + 1;
		while (!isPdfDelimiter(text[end])) end++;
		return {
			value: {
				kind: "name",
				value: decodeRawPdfName(text.slice(index + 1, end)),
			},
			nextIndex: end,
		};
	}

	if (first === "[") {
		const values: RawPdfValue[] = [];
		let cursor = index + 1;
		while (cursor < text.length) {
			cursor = skipPdfWhitespaceAndComments(text, cursor);
			if (text[cursor] === "]") {
				return { value: { kind: "array", values }, nextIndex: cursor + 1 };
			}
			const item = readRawPdfValue(text, cursor);
			if (!item || item.nextIndex <= cursor) return null;
			values.push(item.value);
			cursor = item.nextIndex;
		}
		return null;
	}

	if (text.slice(index, index + 2) === "<<") {
		const end = findPdfDictionaryEnd(text, index);
		return end < 0 ? null : { value: { kind: "other" }, nextIndex: end };
	}

	if (first === "(") {
		const end = skipPdfLiteralString(text, index);
		return end < 0 ? null : { value: { kind: "other" }, nextIndex: end };
	}

	if (first === "<") {
		const end = text.indexOf(">", index + 1);
		return end < 0 ? null : { value: { kind: "other" }, nextIndex: end + 1 };
	}

	const number = text.slice(index).match(/^[+-]?(?:\d+\.\d*|\.\d+|\d+)/);
	if (number) {
		const afterFirst = index + number[0].length;
		if (/^\d+$/.test(number[0])) {
			const secondStart = skipPdfWhitespaceAndComments(text, afterFirst);
			const second = text.slice(secondStart).match(/^\d+/);
			if (second) {
				const refMarker = skipPdfWhitespaceAndComments(
					text,
					secondStart + second[0].length,
				);
				if (text[refMarker] === "R" && isPdfDelimiter(text[refMarker + 1])) {
					return {
						value: {
							kind: "ref",
							objectNumber: Number(number[0]),
							generationNumber: Number(second[0]),
						},
						nextIndex: refMarker + 1,
					};
				}
			}
		}
		return {
			value: { kind: "number", value: Number(number[0]) },
			nextIndex: afterFirst,
		};
	}

	let end = index + 1;
	while (!isPdfDelimiter(text[end])) end++;
	return { value: { kind: "other" }, nextIndex: end };
}

function readRawPdfDictionaryValue(
	text: string,
	dictionary: { start: number; end: number },
	key: string,
) {
	let cursor = dictionary.start + 2;
	let found: RawPdfValue | null = null;
	while (cursor < dictionary.end - 2) {
		cursor = skipPdfWhitespaceAndComments(text, cursor);
		if (cursor >= dictionary.end - 2) break;
		const keyRead = readRawPdfValue(text, cursor);
		if (!keyRead || keyRead.value.kind !== "name") return null;
		const valueRead = readRawPdfValue(text, keyRead.nextIndex);
		if (!valueRead) return null;
		// PDFDict conserva el último valor cuando una clave está duplicada.
		if (keyRead.value.value === key) found = valueRead.value;
		cursor = valueRead.nextIndex;
	}
	return found;
}

function parseRawPdfObjects(text: string) {
	const objects = new Map<string, RawPdfObject>();
	const records: RawPdfObject[] = [];
	const headers = text.matchAll(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: PDF define seis bytes ASCII específicos como espacios válidos.
		/(\d+)(?:[\x00\x09\x0a\x0c\x0d\x20]+|%[^\r\n]*(?:\r\n|\r|\n))+(\d+)(?:[\x00\x09\x0a\x0c\x0d\x20]+|%[^\r\n]*(?:\r\n|\r|\n))+obj\b/g,
	);
	for (const match of headers) {
		const key = `${match[1]}:${match[2]}`;
		const valueStart = skipPdfWhitespaceAndComments(
			text,
			(match.index ?? 0) + match[0].length,
		);
		if (text.slice(valueStart, valueStart + 2) === "<<") {
			const dictionaryEnd = findPdfDictionaryEnd(text, valueStart);
			if (dictionaryEnd < 0) continue;
			const afterDictionary = skipPdfWhitespaceAndComments(text, dictionaryEnd);
			let streamStart: number | undefined;
			if (
				text.slice(afterDictionary, afterDictionary + 6) === "stream" &&
				isPdfDelimiter(text[afterDictionary + 6])
			) {
				let cursor = afterDictionary + 6;
				while (text[cursor] === " " || text[cursor] === "\t") cursor++;
				if (text.slice(cursor, cursor + 2) === "\r\n") streamStart = cursor + 2;
				else if (text[cursor] === "\n" || text[cursor] === "\r")
					streamStart = cursor + 1;
			}
			const object = {
				key,
				dictionary: { start: valueStart, end: dictionaryEnd },
				streamStart,
			};
			records.push(object);
			objects.set(key, object);
			continue;
		}

		const value = readRawPdfValue(text, valueStart);
		if (value) {
			const object = { key, value: value.value };
			records.push(object);
			objects.set(key, object);
		}
	}
	return { objects, records };
}

function resolveRawPdfValue(
	value: RawPdfValue | null,
	objects: Map<string, RawPdfObject>,
	visited = new Set<string>(),
): RawPdfValue | null {
	if (!value || value.kind !== "ref") return value;
	const key = `${value.objectNumber}:${value.generationNumber}`;
	if (visited.has(key)) return null;
	visited.add(key);
	return resolveRawPdfValue(objects.get(key)?.value ?? null, objects, visited);
}

function getRawStreamFilters(
	value: RawPdfValue | null,
	objects: Map<string, RawPdfObject>,
) {
	if (value?.kind === "ref") return null;
	const resolved = resolveRawPdfValue(value, objects);
	if (!resolved) return [];
	if (resolved.kind === "name") return [resolved.value];
	if (resolved.kind !== "array") return null;
	if (resolved.values.some((item) => item.kind === "ref")) return null;
	const names = resolved.values.map((item) =>
		resolveRawPdfValue(item, objects),
	);
	return names.every((item) => item?.kind === "name")
		? names.map((item) => (item as { kind: "name"; value: string }).value)
		: null;
}

function getResolvedPdfNumber(
	value: RawPdfValue | null,
	objects: Map<string, RawPdfObject>,
) {
	const resolved = resolveRawPdfValue(value, objects);
	return resolved?.kind === "number" ? resolved.value : null;
}

function getDirectPdfNumber(value: RawPdfValue | null) {
	return value?.kind === "number" ? value.value : null;
}

function isSafeParserControlValue(value: number | null, maximum: number) {
	return (
		value !== null &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= maximum
	);
}

function getDirectPdfNumberArray(value: RawPdfValue | null) {
	if (value?.kind !== "array") return null;
	const numbers = value.values.map((item) => getDirectPdfNumber(item));
	return numbers.every((item) => item !== null) ? (numbers as number[]) : null;
}

// pdf-lib descomprime los object streams dentro de load(), fuera de nuestro
// presupuesto. Aqui se inflan primero con el inflater acotado: si revientan el
// limite, load() no llega a ejecutarse.
function checkPdfSafeToParse(
	buffer: Buffer | Uint8Array,
	budget: PdfContentBudget,
	throwOnContentLimit: boolean,
): boolean {
	const bytes = Buffer.from(buffer);
	const text = bytes.toString("latin1");
	const maxDecompressedBytes = budget.remainingBytes;

	for (const match of text.matchAll(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: PDF define seis bytes ASCII específicos como espacios válidos.
		/\/Size(?:[\x00\x09\x0a\x0c\x0d\x20]+|%[^\r\n]*(?:\r\n|\r|\n))+(\d+)/g,
	)) {
		if (Number(match[1]) > MAX_DECLARED_PDF_OBJECTS) return false;
	}

	const { objects, records } = parseRawPdfObjects(text);
	for (const object of records) {
		if (!object.dictionary) continue;
		const type = readRawPdfDictionaryValue(text, object.dictionary, "Type");
		// pdf-lib resuelve referencias para Type; no podemos confiar en un mapa
		// global que también ve bytes comprimidos, así que ese caso se degrada.
		if (type?.kind === "ref") return false;
		if (
			type?.kind !== "name" ||
			(type.value !== "ObjStm" && type.value !== "XRef")
		)
			continue;

		if (type.value === "ObjStm") {
			const objectCount = getDirectPdfNumber(
				readRawPdfDictionaryValue(text, object.dictionary, "N"),
			);
			const firstOffset = getDirectPdfNumber(
				readRawPdfDictionaryValue(text, object.dictionary, "First"),
			);
			if (
				!isSafeParserControlValue(objectCount, MAX_DECLARED_PDF_OBJECTS) ||
				!isSafeParserControlValue(firstOffset, maxDecompressedBytes)
			)
				return false;
		} else {
			const size = getDirectPdfNumber(
				readRawPdfDictionaryValue(text, object.dictionary, "Size"),
			);
			const widths = getDirectPdfNumberArray(
				readRawPdfDictionaryValue(text, object.dictionary, "W"),
			);
			const indexValue = readRawPdfDictionaryValue(
				text,
				object.dictionary,
				"Index",
			);
			const subsections = indexValue
				? getDirectPdfNumberArray(indexValue)
				: size === null
					? null
					: [0, size];
			if (
				!isSafeParserControlValue(size, MAX_DECLARED_PDF_OBJECTS) ||
				!widths ||
				widths.length !== 3 ||
				widths.some((width) => !isSafeParserControlValue(width, 8)) ||
				!subsections ||
				subsections.length % 2 !== 0 ||
				subsections.some(
					(value) => !isSafeParserControlValue(value, MAX_DECLARED_PDF_OBJECTS),
				) ||
				subsections.reduce(
					(total, value, index) => total + (index % 2 === 1 ? value : 0),
					0,
				) > MAX_DECLARED_PDF_OBJECTS
			)
				return false;
		}

		const declaredLength = getResolvedPdfNumber(
			readRawPdfDictionaryValue(text, object.dictionary, "Length"),
			objects,
		);
		const start = object.streamStart;
		const endMarker =
			start !== undefined && declaredLength !== null
				? skipPdfWhitespaceAndComments(text, start + declaredLength)
				: -1;
		if (
			start === undefined ||
			declaredLength === null ||
			!Number.isSafeInteger(declaredLength) ||
			declaredLength <= 0 ||
			start + declaredLength > bytes.length ||
			text.slice(endMarker, endMarker + 9) !== "endstream" ||
			!isPdfDelimiter(text[endMarker + 9])
		)
			return false;

		const filters = getRawStreamFilters(
			readRawPdfDictionaryValue(text, object.dictionary, "Filter"),
			objects,
		);
		if (filters === null || filters.length > 1) return false;
		try {
			if (filters.length === 0) consumeContentBudget(budget, declaredLength);
			else if (filters[0] === "FlateDecode" || filters[0] === "Fl") {
				const inflated = inflatePdfStreamBounded(
					bytes.subarray(start, start + declaredLength),
					budget.remainingBytes,
				);
				consumeContentBudget(budget, inflated.length);
			} else return false;
		} catch (error) {
			if (error instanceof PdfContentBudgetExceededError) {
				if (throwOnContentLimit) throw error;
				return false;
			}
			// Si no podemos comprobar el stream, no se delega su expansión a pdf-lib.
			return false;
		}
	}
	return true;
}

export function isPdfSafeToParse(
	buffer: Buffer | Uint8Array,
	maxDecompressedBytes = MAX_DECOMPRESSED_PDF_CONTENT_BYTES,
): boolean {
	return checkPdfSafeToParse(
		buffer,
		{ remainingBytes: maxDecompressedBytes },
		false,
	);
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
	const contentBudget: PdfContentBudget = {
		remainingBytes: MAX_DECOMPRESSED_PDF_CONTENT_BYTES,
	};
	if (!checkPdfSafeToParse(buffer, contentBudget, true)) {
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

	if (performance.now() - startedAt > PARSE_BUDGET_MS)
		throw new PdfContentTimeBudgetExceededError();
	if (base.pageCount > MAX_PDF_PAGES) {
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
			base.pages = inspectPageContent(
				document,
				startedAt + PARSE_BUDGET_MS,
				contentBudget,
			);
		} catch (error) {
			if (
				error instanceof PdfContentBudgetExceededError ||
				error instanceof PdfContentTimeBudgetExceededError
			)
				throw error;

			base.parseError ??=
				error instanceof Error ? error.message : String(error);
		}
	} else {
		throw new PdfContentTimeBudgetExceededError();
	}

	return base;
}
