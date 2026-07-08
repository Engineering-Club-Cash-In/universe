import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { getBankStatementOpportunityDocumentType } from "./bank-statement-documents";

describe("bank statement opportunity documents", () => {
	test("maps only the first three PDFs to estados_cuenta document types", () => {
		expect(getBankStatementOpportunityDocumentType(0)).toBe("estados_cuenta_1");
		expect(getBankStatementOpportunityDocumentType(1)).toBe("estados_cuenta_2");
		expect(getBankStatementOpportunityDocumentType(2)).toBe("estados_cuenta_3");
		expect(getBankStatementOpportunityDocumentType(3)).toBeUndefined();
	});

	test("persists opportunity attachments only after analysis succeeds", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/bank-analysis.ts"),
			"utf8",
		);
		const successIndex = source.indexOf(
			"const creditCapacity = calculateCreditCapacity",
		);
		const attachmentWriteIndex = source.indexOf(
			"const { key } = await uploadFileToR2(",
		);

		expect(successIndex).toBeGreaterThan(-1);
		expect(attachmentWriteIndex).toBeGreaterThan(successIndex);
	});

	test("requires upload role before enabling opportunity attachments", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/bank-analysis.ts"),
			"utf8",
		);
		const roleGateIndex = source.indexOf(
			'!["admin", "sales", "sales_supervisor", "analyst"].includes(',
		);
		const enableAttachmentsIndex = source.indexOf("opportunityForDocuments = {");

		expect(roleGateIndex).toBeGreaterThan(-1);
		expect(enableAttachmentsIndex).toBeGreaterThan(roleGateIndex);
	});
});
