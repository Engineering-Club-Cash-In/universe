import { describe, expect, test } from "bun:test";
import {
	encodeDocumentIntegrityEvidenceName,
	isImmutableDocumentIntegrityEvidencePath,
	originalNameFromDocumentIntegrityPath,
} from "./evidence-path";

describe("document integrity evidence paths", () => {
	test("solo preserva snapshots bajo validated de la oportunidad", () => {
		const bankStatementPrefix = "bank-statements/opportunity-1";
		expect(
			isImmutableDocumentIntegrityEvidencePath({
				filePath:
					"bank-statements/opportunity-1/validated/validation-1/hash-file.pdf",
				bankStatementPrefix,
			}),
		).toBe(true);
		expect(
			isImmutableDocumentIntegrityEvidencePath({
				filePath: "bank-statements/opportunity-1/file.pdf",
				bankStatementPrefix,
			}),
		).toBe(false);
		expect(
			isImmutableDocumentIntegrityEvidencePath({
				filePath:
					"bank-statements/other-opportunity/validated/validation-1/file.pdf",
				bankStatementPrefix,
			}),
		).toBe(false);
	});

	test("restaura el nombre original desde uploads y snapshots inmutables", () => {
		const hash = "a".repeat(64);
		expect(
			originalNameFromDocumentIntegrityPath(
				"bank-statements/opportunity-1/1750000000000-abc123-estado-junio.pdf",
			),
		).toBe("estado-junio.pdf");
		expect(
			originalNameFromDocumentIntegrityPath(
				`bank-statements/opportunity-1/validated/validation-1/${hash}-1750000000000-abc123-estado-junio.pdf`,
			),
		).toBe("estado-junio.pdf");
	});

	test("el nombre original sobrevive espacios y acentos en el snapshot", () => {
		const hash = "b".repeat(64);
		const originalName = "Estado de cuenta José (1).pdf";
		const encoded = encodeDocumentIntegrityEvidenceName(originalName);
		expect(encoded).toMatch(/^[A-Za-z0-9._%-]+$/);
		expect(
			originalNameFromDocumentIntegrityPath(
				`bank-statements/opportunity-1/validated/validation-1/${hash}-${encoded}`,
			),
		).toBe(originalName);
	});

	test("acota el nombre codificado para no exceder el límite de la llave", () => {
		const encoded = encodeDocumentIntegrityEvidenceName(
			`${"é".repeat(400)}.pdf`,
		);
		expect(encoded.length).toBeLessThanOrEqual(700);
		expect(encoded).toMatch(/^[A-Za-z0-9._%-]+$/);
		// Recortado por code points: sigue siendo decodificable.
		expect(() => decodeURIComponent(encoded)).not.toThrow();
	});

	test("un snapshot antiguo con % inválido no rompe la restauración", () => {
		const hash = "c".repeat(64);
		expect(
			originalNameFromDocumentIntegrityPath(
				`bank-statements/opportunity-1/validated/validation-1/${hash}-estado_100%_junio.pdf`,
			),
		).toBe("estado_100%_junio.pdf");
	});
});
