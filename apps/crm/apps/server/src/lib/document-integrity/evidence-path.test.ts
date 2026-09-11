import { describe, expect, test } from "bun:test";
import { isImmutableDocumentIntegrityEvidencePath } from "./evidence-path";

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
});
