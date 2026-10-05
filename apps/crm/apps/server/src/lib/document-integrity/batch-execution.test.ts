import { describe, expect, mock, test } from "bun:test";
import { executeBatchWithFallback, indexBatchResults } from "./batch-execution";

const documents = (count: number, size = 10) =>
	Array.from({ length: count }, (_, index) => ({
		reference: `document_${index + 1}`,
		buffer: Buffer.alloc(size),
	}));

describe("document integrity batch execution", () => {
	for (const count of [1, 4, 9]) {
		test(`${count} documento(s) usan una sola llamada normal`, async () => {
			const callBatch = mock(
				async (batch: ReturnType<typeof documents>) =>
					new Map(batch.map((document) => [document.reference, "ok"])),
			);

			const result = await executeBatchWithFallback(documents(count), {
				maxBatchSizeBytes: 1_000,
				callBatch,
			});

			expect(callBatch).toHaveBeenCalledTimes(1);
			expect(callBatch.mock.calls[0]?.[0]).toHaveLength(count);
			expect(result.analyses).toHaveLength(count);
			expect(result.errors).toHaveLength(0);
		});
	}

	test("solo usa llamadas individuales cuando falla el lote", async () => {
		const callBatch = mock(async (batch: ReturnType<typeof documents>) => {
			if (batch.length > 1) throw new Error("batch unavailable");
			return new Map([[batch[0].reference, "ok"]]);
		});

		const result = await executeBatchWithFallback(documents(4), {
			maxBatchSizeBytes: 1_000,
			callBatch,
		});

		expect(callBatch).toHaveBeenCalledTimes(5);
		expect(result.analyses).toHaveLength(4);
		expect(result.errors).toHaveLength(0);
	});

	test("un lote mayor al límite omite el intento conjunto", async () => {
		const callBatch = mock(
			async (batch: ReturnType<typeof documents>) =>
				new Map([[batch[0].reference, "ok"]]),
		);

		await executeBatchWithFallback(documents(3, 10), {
			maxBatchSizeBytes: 20,
			callBatch,
		});

		expect(callBatch).toHaveBeenCalledTimes(3);
		expect(callBatch.mock.calls.every(([batch]) => batch.length === 1)).toBe(
			true,
		);
	});

	test("aísla el error de un documento durante el fallback", async () => {
		const callBatch = mock(async (batch: ReturnType<typeof documents>) => {
			if (batch.length > 1) throw new Error("batch unavailable");
			if (batch[0].reference === "document_2")
				throw new Error("document error");
			return new Map([[batch[0].reference, "ok"]]);
		});

		const result = await executeBatchWithFallback(documents(3), {
			maxBatchSizeBytes: 1_000,
			callBatch,
		});

		expect(result.analyses).toHaveLength(2);
		expect(result.errors.get("document_2")).toBe("document error");
	});

	test("limita la concurrencia del fallback", async () => {
		let activeCalls = 0;
		let maximumActiveCalls = 0;
		const callBatch = mock(async (batch: ReturnType<typeof documents>) => {
			if (batch.length > 1) throw new Error("batch unavailable");
			activeCalls++;
			maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
			await Promise.resolve();
			await Promise.resolve();
			activeCalls--;
			return new Map([[batch[0].reference, "ok"]]);
		});

		await executeBatchWithFallback(documents(9), {
			maxBatchSizeBytes: 1_000,
			callBatch,
			fallbackConcurrency: 2,
		});

		expect(maximumActiveCalls).toBe(2);
		expect(callBatch).toHaveBeenCalledTimes(10);
	});

	test("un rate limit no dispara más llamadas", async () => {
		const rateLimit = Object.assign(new Error("rate limit"), {
			statusCode: 429,
		});
		const callBatch = mock(async () => {
			throw rateLimit;
		});

		const result = await executeBatchWithFallback(documents(4), {
			maxBatchSizeBytes: 1_000,
			callBatch,
			shouldFallback: (error) =>
				(error as { statusCode?: number }).statusCode !== 429,
		});

		expect(callBatch).toHaveBeenCalledTimes(1);
		expect(result.errors).toHaveLength(4);
	});

	test("acepta respuestas reordenadas y las indexa por document_ref", () => {
		const indexed = indexBatchResults({
			expectedReferences: ["document_1", "document_2"],
			results: [
				{ document_ref: "document_2", value: 2 },
				{ document_ref: "document_1", value: 1 },
			],
			getReference: (result) => result.document_ref,
			mapResult: (result) => result.value,
		});

		expect(indexed.get("document_1")).toBe(1);
		expect(indexed.get("document_2")).toBe(2);
	});

	test("rechaza respuestas incompletas, duplicadas o ajenas", () => {
		const index = (references: string[]) =>
			indexBatchResults({
				expectedReferences: ["document_1", "document_2"],
				results: references.map((document_ref) => ({ document_ref })),
				getReference: (result) => result.document_ref,
				mapResult: (result) => result,
			});

		expect(() => index(["document_1"])).toThrow("1 resultados para 2");
		expect(() => index(["document_1", "document_1"])).toThrow(
			"document_ref inválido",
		);
		expect(() => index(["document_1", "document_3"])).toThrow(
			"document_ref inválido",
		);
	});
});
