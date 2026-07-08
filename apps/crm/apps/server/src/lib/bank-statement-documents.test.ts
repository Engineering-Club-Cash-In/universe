import { describe, expect, test } from "bun:test";
import { getBankStatementOpportunityDocumentType } from "./bank-statement-documents";

describe("bank statement opportunity documents", () => {
	test("maps only the first three PDFs to estados_cuenta document types", () => {
		expect(getBankStatementOpportunityDocumentType(0)).toBe("estados_cuenta_1");
		expect(getBankStatementOpportunityDocumentType(1)).toBe("estados_cuenta_2");
		expect(getBankStatementOpportunityDocumentType(2)).toBe("estados_cuenta_3");
		expect(getBankStatementOpportunityDocumentType(3)).toBeUndefined();
	});
});
