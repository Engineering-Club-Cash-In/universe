import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	canAutoAttachBankStatementDocuments,
	getBankStatementOpportunityDocumentType,
	resolveBankStatementDocumentSlots,
} from "./bank-statement-documents";

describe("bank statement opportunity documents", () => {
	test("maps only the first three PDFs to estados_cuenta document types", () => {
		expect(getBankStatementOpportunityDocumentType(0)).toBe("estados_cuenta_1");
		expect(getBankStatementOpportunityDocumentType(1)).toBe("estados_cuenta_2");
		expect(getBankStatementOpportunityDocumentType(2)).toBe("estados_cuenta_3");
		expect(getBankStatementOpportunityDocumentType(3)).toBeUndefined();
	});

	test("marks all 3 checklist slots when a single PDF has 3 statements merged", () => {
		// Ej. el usuario sube un solo PDF con los 3 estados de cuenta fusionados.
		expect(
			resolveBankStatementDocumentSlots({
				uploadedFileCount: 1,
				statementsDetected: 3,
			}),
		).toEqual([0, 0, 0]);
	});

	test("keeps one slot per file when 3 independent PDFs are uploaded", () => {
		expect(
			resolveBankStatementDocumentSlots({
				uploadedFileCount: 3,
				statementsDetected: 3,
			}),
		).toEqual([0, 1, 2]);
	});

	test("fills the remaining slots with the last file when there are fewer files than statements", () => {
		// 2 PDFs, pero el segundo trae 2 estados de cuenta fusionados.
		expect(
			resolveBankStatementDocumentSlots({
				uploadedFileCount: 2,
				statementsDetected: 3,
			}),
		).toEqual([0, 1, 1]);
	});

	test("still marks 3 slots when statement periods overlap between files", () => {
		// 3 archivos con periodos traslapados; la IA solo confirma 2 meses únicos.
		expect(
			resolveBankStatementDocumentSlots({
				uploadedFileCount: 3,
				statementsDetected: 2, // la IA solo pudo confirmar 2 con certeza
			}),
		).toEqual([0, 1, 2]);
	});

	test("caps slots at 3 even with more files or statements", () => {
		expect(
			resolveBankStatementDocumentSlots({
				uploadedFileCount: 9,
				statementsDetected: 12,
			}),
		).toEqual([0, 1, 2]);
	});

	test("does not fill slots when no files were uploaded", () => {
		expect(
			resolveBankStatementDocumentSlots({
				uploadedFileCount: 0,
				statementsDetected: 3,
			}),
		).toEqual([]);
	});

	test("allows auto-attachments only for upload roles and assigned sales users", () => {
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "admin",
				userId: "user-1",
				opportunityAssignedTo: "user-2",
			}),
		).toBe(true);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "sales",
				userId: "user-1",
				opportunityAssignedTo: "user-1",
			}),
		).toBe(true);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "sales",
				userId: "user-1",
				opportunityAssignedTo: "user-2",
			}),
		).toBe(false);
		expect(
			canAutoAttachBankStatementDocuments({
				userRole: "juridico",
				userId: "user-1",
				opportunityAssignedTo: "user-1",
			}),
		).toBe(false);
	});

	test("writes opportunity attachments only after AI analysis succeeds and is persisted", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/bank-analysis.ts"),
			"utf8",
		);
		const successIndex = source.indexOf(
			"const creditCapacity = calculateCreditCapacity",
		);
		const persistedAnalysisIndex = source.indexOf(
			"fullAnalysis: JSON.stringify(analysis)",
		);
		const attachmentWriteIndex = source.indexOf(
			"const { key } = await uploadFileToR2(",
		);

		expect(successIndex).toBeGreaterThan(-1);
		expect(persistedAnalysisIndex).toBeGreaterThan(successIndex);
		expect(attachmentWriteIndex).toBeGreaterThan(persistedAnalysisIndex);
	});

	test("keeps non-upload roles analyzing while skipping auto-attachments", () => {
		const source = readFileSync(
			join(import.meta.dir, "../routers/bank-analysis.ts"),
			"utf8",
		);
		const permissionCheckIndex = source.indexOf(
			"canAutoAttachBankStatementDocuments({",
		);
		const enableAttachmentsIndex = source.indexOf("opportunityForDocuments = {");

		expect(permissionCheckIndex).toBeGreaterThan(-1);
		expect(enableAttachmentsIndex).toBeGreaterThan(permissionCheckIndex);
		expect(source).not.toContain('message: "No tienes permiso para subir documentos"');
	});
});
