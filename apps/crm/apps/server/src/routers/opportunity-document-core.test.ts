import { describe, expect, test } from "bun:test";
import { runReservedBankStatementCoverageMutationCore } from "./bank-analysis-coverage";
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

function opportunityLock(rows: Row[], checklist: { uploaded: boolean }) {
	const transaction = statefulTransaction(rows, checklist);
	return <T>(
		_opportunityId: string,
		operation: (tx: { name: "tx" }) => Promise<T>,
	) => transaction(operation);
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
	test("upload and delete reuse the locked transaction without nested connection requests", async () => {
		const rows: Row[] = [];
		const checklist = { uploaded: false };
		type BudgetTx = { name: "locked" | "follow-up" };
		const lockedTx: BudgetTx = { name: "locked" };
		let outerLockActive = false;
		let opportunityLockTransactions = 0;
		let followUpTransactions = 0;
		const withOpportunityLock = async <T>(
			_opportunityId: string,
			operation: (tx: BudgetTx) => Promise<T>,
		) => {
			opportunityLockTransactions += 1;
			outerLockActive = true;
			try {
				return await operation(lockedTx);
			} finally {
				outerLockActive = false;
			}
		};
		const runTransaction = async <T>(
			operation: (tx: BudgetTx) => Promise<T>,
		) => {
			if (outerLockActive) throw new Error("nested connection requested");
			followUpTransactions += 1;
			return operation({ name: "follow-up" });
		};

		const uploaded = await runOpportunityDocumentUploadCore({
			opportunityId: "opportunity-1",
			actorId: "user-1",
			documentType: "estados_cuenta_1",
			uploadedKey: "opportunities/opportunity-1/manual.pdf",
			withOpportunityLock,
			findExistingBankSlot: async (tx) => {
				expect(tx).toBe(lockedTx);
				return null;
			},
			insertDocument: async (tx) => {
				expect(tx).toBe(lockedTx);
				const row = { ...manualRow(), documentType: "estados_cuenta_1" };
				rows.push(row);
				return row;
			},
			refreshChecklist: async (tx) => {
				expect(tx).toBe(lockedTx);
				checklist.uploaded = true;
			},
			deleteUploadedFile: async () => {},
			persistCleanupDebt: async () => {},
		});
		expect(uploaded.id).toBe("manual-1");
		expect(opportunityLockTransactions).toBe(1);
		expect(followUpTransactions).toBe(0);

		await runOpportunityDocumentDeleteCore({
			documentId: uploaded.id,
			opportunityId: uploaded.opportunityId,
			actorId: "user-1",
			documentType: uploaded.documentType,
			description: uploaded.description,
			withOpportunityLock,
			runTransaction,
			readDocument: async (tx) => {
				expect(tx).toBe(lockedTx);
				return rows[0] ?? null;
			},
			quarantineAndRefresh: async (tx, current, tag) => {
				expect(tx).toBe(lockedTx);
				current.documentType = "other";
				current.description = tag;
				checklist.uploaded = false;
			},
			deleteStoredFile: async () => {
				expect(outerLockActive).toBe(false);
			},
			deleteDocumentAndRefresh: async (tx, current) => {
				expect(tx).toBe(lockedTx);
				rows.splice(
					rows.findIndex(({ id }) => id === current.id),
					1,
				);
			},
		});
		expect(opportunityLockTransactions).toBe(3);
		expect(followUpTransactions).toBe(0);
		expect(rows).toEqual([]);
		expect(checklist.uploaded).toBe(false);
	});

	test("post-R2 bank cleanup cannot overlap coverage promotion or overwrite its checklist", async () => {
		const rows = [manualRow()];
		const checklist = { uploaded: true };
		const transaction = statefulTransaction(rows, checklist);
		let lockCalls = 0;
		let plainTransactions = 0;
		let activeCoverageMutation = false;
		let deleteDocumentCalls = 0;
		let signalFinalizationAttempt = () => {};
		const finalizationAttempted = new Promise<void>((resolve) => {
			signalFinalizationAttempt = resolve;
		});
		let signalCoverageStaged = () => {};
		const coverageStaged = new Promise<void>((resolve) => {
			signalCoverageStaged = resolve;
		});
		let coverageMutation: Promise<void> | undefined;
		const withOpportunityLock = async <T>(
			_opportunityId: string,
			operation: (tx: { name: "tx" }) => Promise<T>,
		) => {
			lockCalls += 1;
			if (lockCalls === 2) {
				signalFinalizationAttempt();
				if (activeCoverageMutation) {
					throw new Error("active coverage mutation");
				}
			}
			return transaction(operation);
		};

		const deletion = runOpportunityDocumentDeleteCore({
			documentId: "manual-1",
			opportunityId: "opportunity-1",
			actorId: "deleter-1",
			documentType: "estados_cuenta_2",
			description: "Adjunto manual",
			withOpportunityLock,
			runTransaction: async (operation) => {
				plainTransactions += 1;
				return transaction(operation);
			},
			readDocument: async () =>
				rows.find(({ id }) => id === "manual-1") ?? null,
			quarantineAndRefresh: async (_tx, current, tag) => {
				current.documentType = "other";
				current.description = tag;
				checklist.uploaded = false;
			},
			deleteStoredFile: async () => {
				coverageMutation = runReservedBankStatementCoverageMutationCore({
					reserve: async () => {
						activeCoverageMutation = true;
						return { token: "coverage-token" };
					},
					loadCurrentOpportunity: async () => undefined,
					loadCurrentCoverage: async () => ({}),
					mutateCurrentCoverage: async () => {
						rows.push({
							id: "coverage-1",
							opportunityId: "opportunity-1",
							documentType: "other",
							description: "staged coverage",
							filePath: "opportunities/opportunity-1/coverage.pdf",
						});
						signalCoverageStaged();
						await finalizationAttempted;
						const staged = rows.find(({ id }) => id === "coverage-1");
						if (staged) staged.documentType = "estados_cuenta_2";
						checklist.uploaded = true;
					},
					release: async () => {
						activeCoverageMutation = false;
					},
				});
				await coverageStaged;
			},
			deleteDocumentAndRefresh: async (_tx, current) => {
				deleteDocumentCalls += 1;
				const uploaded = rows.some(
					(row) =>
						row.id !== current.id && row.documentType === "estados_cuenta_2",
				);
				signalFinalizationAttempt();
				await coverageMutation;
				rows.splice(
					rows.findIndex(({ id }) => id === current.id),
					1,
				);
				checklist.uploaded = uploaded;
			},
		});

		await expect(deletion).rejects.toThrow("active coverage mutation");
		await coverageMutation;
		expect(lockCalls).toBe(2);
		expect(plainTransactions).toBe(0);
		expect(deleteDocumentCalls).toBe(0);
		expect(rows).toEqual([
			expect.objectContaining({ id: "manual-1", documentType: "other" }),
			expect.objectContaining({
				id: "coverage-1",
				documentType: "estados_cuenta_2",
			}),
		]);
		expect(checklist.uploaded).toBe(true);
	});

	test("compensates the exact pre-uploaded key when the locked slot is occupied", async () => {
		const rows: Row[] = [];
		const blobs = new Set(["opportunities/opportunity-1/manual.pdf"]);
		const debt: ManualBankDocumentCleanupDebt[] = [];
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
			withOpportunityLock: (_opportunityId, operation) =>
				lock(() => operation({ name: "tx" })),
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
				withOpportunityLock: opportunityLock(rows, checklist),
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
				withOpportunityLock: opportunityLock(rows, checklist),
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
			withOpportunityLock: opportunityLock(rows, checklist),
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
				withOpportunityLock: async (_opportunityId, operation) =>
					operation({ name: "tx" }),
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
				withOpportunityLock: opportunityLock(rows, checklist),
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
					withOpportunityLock: opportunityLock(rows, checklist),
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
