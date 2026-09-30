import { describe, expect, test } from "bun:test";
import { isBankStatementChecklistType } from "server/src/routers/opportunity-document-core";
import {
	COFIRMANTE_BANK_STATEMENT_OPTION,
	getManualOpportunityDocumentFields,
} from "./manual-opportunity-document";

const uploadSources = await Promise.all(
	[
		"../routes/crm/opportunities.tsx",
		"../components/opportunity-document-upload.tsx",
	].map((path) => Bun.file(new URL(path, import.meta.url)).text()),
);

describe("adjuntos manuales del cofirmante", () => {
	test("traduce la opción UI a other sin ocupar meses del titular", () => {
		const fields = getManualOpportunityDocumentFields(
			COFIRMANTE_BANK_STATEMENT_OPTION.value,
		);
		expect(fields).toEqual({
			documentType: "other",
			description: "Estados de cuenta del cofirmante",
		});
		expect(isBankStatementChecklistType(fields.documentType)).toBe(false);
	});

	test("conserva una descripción que identifica al cofirmante y los meses", () => {
		expect(
			getManualOpportunityDocumentFields(
				COFIRMANTE_BANK_STATEMENT_OPTION.value,
				"  Ana, enero-marzo  ",
			).description,
		).toBe("Estados de cuenta del cofirmante: Ana, enero-marzo");
	});

	test("no convierte estados del titular ni otros documentos", () => {
		for (const type of [
			"estados_cuenta_1",
			"estados_cuenta_2",
			"estados_cuenta_3",
			"other",
			"dpi",
		] as const) {
			expect(getManualOpportunityDocumentFields(type, "Descripción")).toEqual({
				documentType: type,
				description: "Descripción",
			});
		}
	});

	for (const [index, source] of uploadSources.entries()) {
		test(`upload UI ${index} ofrece evidencia del cofirmante por la API existente`, () => {
			expect(source).toContain("COFIRMANTE_BANK_STATEMENT_OPTION");
			expect(source).toContain("getManualOpportunityDocumentFields(");
			expect(source).toContain("COFIRMANTE_BANK_STATEMENT_HELP");
		});
	}
});
