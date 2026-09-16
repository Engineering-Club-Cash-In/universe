export interface BatchDocument {
	reference: string;
	buffer: { length: number };
}

export interface BatchExecutionOptions<
	TDocument extends BatchDocument,
	TResult,
> {
	maxBatchSizeBytes: number;
	callBatch: (documents: TDocument[]) => Promise<Map<string, TResult>>;
	onBatchFailure?: (error: unknown) => void;
	shouldFallback?: (error: unknown) => boolean;
	fallbackConcurrency?: number;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function indexBatchResults<TInput, TResult>(params: {
	expectedReferences: string[];
	results: TInput[];
	getReference: (result: TInput) => string;
	mapResult: (result: TInput) => TResult;
}): Map<string, TResult> {
	if (params.results.length !== params.expectedReferences.length) {
		throw new Error(
			`Gemini devolvió ${params.results.length} resultados para ${params.expectedReferences.length} documentos`,
		);
	}

	const expectedReferences = new Set(params.expectedReferences);
	const indexed = new Map<string, TResult>();
	for (const result of params.results) {
		const reference = params.getReference(result);
		if (!expectedReferences.has(reference) || indexed.has(reference)) {
			throw new Error(`Gemini devolvió un document_ref inválido: ${reference}`);
		}
		indexed.set(reference, params.mapResult(result));
	}
	return indexed;
}

export async function executeBatchWithFallback<
	TDocument extends BatchDocument,
	TResult,
>(
	documents: TDocument[],
	options: BatchExecutionOptions<TDocument, TResult>,
): Promise<{
	analyses: Map<string, TResult>;
	errors: Map<string, string>;
}> {
	const analyses = new Map<string, TResult>();
	const errors = new Map<string, string>();
	if (documents.length === 0) return { analyses, errors };

	try {
		const totalSize = documents.reduce(
			(sum, document) => sum + document.buffer.length,
			0,
		);
		if (totalSize > options.maxBatchSizeBytes) {
			throw new Error(
				`El lote excede ${options.maxBatchSizeBytes} bytes y requiere procesamiento individual`,
			);
		}
		return {
			analyses: await options.callBatch(documents),
			errors,
		};
	} catch (error) {
		options.onBatchFailure?.(error);
		if (options.shouldFallback?.(error) === false) {
			for (const document of documents)
				errors.set(document.reference, errorMessage(error));
			return { analyses, errors };
		}
	}

	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < documents.length) {
			const index = nextIndex++;
			const document = documents[index];
			try {
				const result = await options.callBatch([document]);
				const analysis = result.get(document.reference);
				if (analysis) analyses.set(document.reference, analysis);
				else
					errors.set(
						document.reference,
						"Gemini no devolvió el resultado del documento",
					);
			} catch (error) {
				errors.set(document.reference, errorMessage(error));
			}
		}
	};
	const concurrency = Math.min(
		documents.length,
		Math.max(1, options.fallbackConcurrency ?? 2),
	);
	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return { analyses, errors };
}
