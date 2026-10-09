import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { runDocumentIntegrityEngine } from "./engine";
import { stripNulCharacters } from "./postgres-safe";

const NUL = "\u0000";

describe("stripNulCharacters", () => {
	test("quita U+0000 de strings anidados y conserva lo demás", () => {
		const date = new Date("2026-10-07T00:00:00Z");
		const cleaned = stripNulCharacters({
			[`clave${NUL}`]: [`a${NUL}b`, 1, null, { c: `d${NUL}` }],
			date,
			flag: true,
		});

		expect(cleaned).toEqual({
			clave: ["ab", 1, null, { c: "d" }],
			date,
			flag: true,
		});
		expect(cleaned.date).toBe(date);
	});

	test("la huella de un PDF con productor de escáner queda guardable", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		document.setProducer(`Adobe PSL 1.3e for Canon${NUL}`);
		const result = await runDocumentIntegrityEngine({
			buffer: Buffer.from(await document.save()),
			llm: null,
			registeredNames: [],
		});

		expect(JSON.stringify(result.technicalFingerprint)).toContain("\\u0000");
		const cleaned = stripNulCharacters(result.technicalFingerprint);
		expect(JSON.stringify(cleaned)).not.toContain("\\u0000");
		expect(cleaned.producer).toBe("Adobe PSL 1.3e for Canon");
	});
});
