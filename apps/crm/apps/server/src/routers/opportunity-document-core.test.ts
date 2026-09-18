import { describe, expect, test } from "bun:test";
import {
	getManualBankUploadCleanupDescription,
	isManualBankDocumentCleanupDescription,
	type ManualBankDocumentCleanupDebt,
	runOpportunityDocumentDeleteCore,
	runOpportunityDocumentUploadCore,
} from "./opportunity-document-core";

interface Row {
	id: string;
	opportunityId: string;
	documentType: string;
	description: string | null;
	filePath: string;
}

function serializedLock() {
	let tail = Promise.resolve();
	return async <T>(operation: () => Promise<T>): Promise<T> => {
		const previous = tail;
		let release = () => {};
		tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	};
}

function statefulTransaction(rows: Row[], checklist: { uploaded: boolean }) {
	return async <T>(operation: (tx: { name: "tx" }) => Promise<T>) => {
		const rowsBefore = structuredClone(rows);
		const checklistBefore = checklist.uploaded;
		try {
			return await operation({ name: "tx" });
		} catch (error) {
			rows.splice(0, rows.length, ...rowsBefore);
			checklist.uploaded = checklistBefore;
			throw error;
		}
	};
}

function manualRow(): Row {
	return {
		id: "manual-1",
		opportunityId: "opportunity-1",
		documentType: "estados_cuenta_2",
		description: "Adjunto manual",
		filePath: "opportunities/opportunity-1/manual.pdf",
	};
}

describe("opportunity bank document production cores", () => {
	test("compensates the exact pre-uploaded key when the locked slot is occupied", async () => {
		const rows: Row[] = [];
		const blobs = new Set(["opportunities/opportunity-1/manual.pdf"]);
		const debt: ManualBankDocumentCleanupDebt[] = [];
		const checklist = { uploaded: false };
		const lock = serializedLock();
		const autoInsert = lock(async () => {
			rows.push({
				id: "auto-1",
				opportunityId: "opportunity-1",
				documentType: "estados_cuenta_1",
				description:
					"[bank-coverage:batch-1:type:estados_cuenta_1:file:0:month:2026-01]",
				filePath: "opportunities/opportunity-1/auto.pdf",
			});
		});
		const manualInsert = runOpportunityDocumentUploadCore({
			opportunityId: "opportunity-1",
			actorId: "user-1",
			documentType: "estados_cuenta_1",
			uploadedKey: "opportunities/opportunity-1/manual.pdf",
			withOpportunityLock: (_opportunityId, operation) => lock(operation),
			runTransaction: statefulTransaction(rows, checklist),
			findExistingBankSlot: async () =>
				rows.find(
					(row) =>
						row.opportunityId === "opportunity-1" &&
						row.documentType === "estados_cuenta_1",
				) ?? null,
			insertDocument: async () => {
				throw new Error("must not insert");
			},
			refreshChecklist: async () => {},
			deleteUploadedFile: async (key) => {
				blobs.delete(key);
			},
			persistCleanupDebt: async (item) => {
				debt.push(item);
			},
		});

		await autoInsert;
		await expect(manualInsert).rejects.toThrow("ya está ocupado");
		expect(rows.map(({ id }) => id)).toEqual(["auto-1"]);
		expect(blobs.size).toBe(0);
		expect(debt).toEqual([]);
	});

	test("rolls back an inserted row and compensates R2 when checklist persistence fails", async () => {
		const rows: Row[] = [];
		const blobs = new Set(["opportunities/opportunity-1/manual.pdf"]);
		const checklist = { uploaded: false };

		await expect(
			runOpportunityDocumentUploadCore({
				opportunityId: "opportunity-1",
				actorId: "user-1",
				documentType: "estados_cuenta_1",
				uploadedKey: "opportunities/opportunity-1/manual.pdf",
				withOpportunityLock: async (_opportunityId, operation) => operation(),
				runTransaction: statefulTransaction(rows, checklist),
				findExistingBankSlot: async () => null,
				insertDocument: async () => {
					const row = { ...manualRow(), documentType: "estados_cuenta_1" };
					rows.push(row);
					return row;
				},
				refreshChecklist: async () => {
					checklist.uploaded = true;
					throw new Error("checklist write failed");
				},
				deleteUploadedFile: async (key) => {
					blobs.delete(key);
				},
				persistCleanupDebt: async () => {
					throw new Error("unexpected debt");
				},
			}),
		).rejects.toThrow("checklist write failed");
		expect(rows).toEqual([]);
		expect(checklist.uploaded).toBe(false);
		expect(blobs.size).toBe(0);
	});

	test("persists exact private cleanup debt when upload compensation cannot delete R2", async () => {
		const rows: Row[] = [];
		const blobs = new Set(["opportunities/opportunity-1/manual.pdf"]);
		const checklist = { uploaded: false };
		const debt: ManualBankDocumentCleanupDebt[] = [];

		await expect(
			runOpportunityDocumentUploadCore({
				opportunityId: "opportunity-1",
				actorId: "user-1",
				documentType: "estados_cuenta_1",
				uploadedKey: "opportunities/opportunity-1/manual.pdf",
				withOpportunityLock: async (_opportunityId, operation) => operation(),
				runTransaction: statefulTransaction(rows, checklist),
				findExistingBankSlot: async () => ({ id: "occupied" }),
				insertDocument: async () => manualRow(),
				refreshChecklist: async () => {},
				deleteUploadedFile: async () => {
					throw new Error("R2 unavailable");
				},
				persistCleanupDebt: async (item) => {
					debt.push(item);
					rows.push({
						id: "debt-1",
						opportunityId: item.opportunityId,
						documentType: "other",
						description: getManualBankUploadCleanupDescription(item),
						filePath: item.key,
					});
				},
			}),
		).rejects.toThrow("ya está ocupado");
		expect(debt).toEqual([
			{
				status: "pending",
				purpose: "upload_cleanup",
				key: "opportunities/opportunity-1/manual.pdf",
				opportunityId: "opportunity-1",
				actorId: "user-1",
				documentType: "estados_cuenta_1",
			},
		]);
		expect(rows[0]).toMatchObject({
			documentType: "other",
			filePath: "opportunities/opportunity-1/manual.pdf",
		});
		expect(checklist.uploaded).toBe(false);

		await runOpportunityDocumentDeleteCore({
			documentId: "debt-1",
			opportunityId: "opportunity-1",
			actorId: "user-1",
			documentType: "other",
			description: rows[0]?.description,
			withOpportunityLock: async (_opportunityId, operation) => operation(),
			runTransaction: statefulTransaction(rows, checklist),
			readDocument: async () => rows[0] ?? null,
			quarantineAndRefresh: async () => {},
			deleteStoredFile: async (current) => {
				blobs.delete(current.filePath);
			},
			deleteDocumentAndRefresh: async (_tx, current) => {
				rows.splice(
					rows.findIndex(({ id }) => id === current.id),
					1,
				);
			},
		});
		expect(rows).toEqual([]);
		expect(blobs.size).toBe(0);
	});

	test("blocks deletion of a current reserved coverage artifact", async () => {
		const row: Row = {
			...manualRow(),
			id: "auto-1",
			documentType: "estados_cuenta_1",
			description:
				"[bank-coverage:batch-1:type:estados_cuenta_1:file:0:month:2026-01]",
		};
		let deletedFromR2 = false;
		await expect(
			runOpportunityDocumentDeleteCore({
				documentId: row.id,
				opportunityId: row.opportunityId,
				actorId: "user-1",
				documentType: row.documentType,
				description: row.description,
				withOpportunityLock: async (_opportunityId, operation) => operation(),
				runTransaction: async (operation) => operation({ name: "tx" }),
				readDocument: async () => row,
				quarantineAndRefresh: async () => {},
				deleteStoredFile: async () => {
					deletedFromR2 = true;
				},
				deleteDocumentAndRefresh: async () => {},
			}),
		).rejects.toThrow("administrado por la cobertura mensual");
		expect(deletedFromR2).toBe(false);
	});

	test("R2 delete failure leaves a quarantined row and a false checklist", async () => {
		const rows = [manualRow()];
		const checklist = { uploaded: true };
		const transaction = statefulTransaction(rows, checklist);

		await expect(
			runOpportunityDocumentDeleteCore({
				documentId: "manual-1",
				opportunityId: "opportunity-1",
				actorId: "deleter-1",
				documentType: "estados_cuenta_2",
				description: "Adjunto manual",
				withOpportunityLock: async (_opportunityId, operation) => operation(),
				runTransaction: transaction,
				readDocument: async () => rows[0] ?? null,
				quarantineAndRefresh: async (_tx, current, tag) => {
					current.documentType = "other";
					current.description = tag;
					checklist.uploaded = false;
				},
				deleteStoredFile: async () => {
					throw new Error("R2 delete failed");
				},
				deleteDocumentAndRefresh: async () => {},
			}),
		).rejects.toThrow("R2 delete failed");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.documentType).toBe("other");
		expect(isManualBankDocumentCleanupDescription(rows[0]?.description)).toBe(
			true,
		);
		expect(checklist.uploaded).toBe(false);
	});

	for (const failure of [
		"db delete failed",
		"checklist write failed",
	] as const) {
		test(`${failure} keeps durable quarantine and a retry converges`, async () => {
			const rows = [manualRow()];
			const blobs = new Set([rows[0].filePath]);
			const checklist = { uploaded: true };
			const transaction = statefulTransaction(rows, checklist);
			let fail = true;
			const execute = () =>
				runOpportunityDocumentDeleteCore({
					documentId: "manual-1",
					opportunityId: "opportunity-1",
					actorId: "deleter-1",
					documentType: rows[0]?.documentType ?? "other",
					description: rows[0]?.description,
					withOpportunityLock: async (_opportunityId, operation) => operation(),
					runTransaction: transaction,
					readDocument: async () => rows[0] ?? null,
					quarantineAndRefresh: async (_tx, current, tag) => {
						current.documentType = "other";
						current.description = tag;
						checklist.uploaded = false;
					},
					deleteStoredFile: async (current) => {
						blobs.delete(current.filePath);
					},
					deleteDocumentAndRefresh: async (_tx, current) => {
						const index = rows.findIndex(({ id }) => id === current.id);
						if (failure === "db delete failed" && fail)
							throw new Error(failure);
						rows.splice(index, 1);
						if (failure === "checklist write failed" && fail) {
							throw new Error(failure);
						}
						checklist.uploaded = false;
					},
				});

			await expect(execute()).rejects.toThrow(failure);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.documentType).toBe("other");
			expect(checklist.uploaded).toBe(false);
			expect(blobs.size).toBe(0);

			fail = false;
			await execute();
			expect(rows).toEqual([]);
			expect(checklist.uploaded).toBe(false);
		});
	}
});
