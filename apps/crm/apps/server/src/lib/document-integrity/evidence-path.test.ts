import { describe, expect, test } from "bun:test";
import {
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
});
