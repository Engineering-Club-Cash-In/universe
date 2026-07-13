/**
 * Igual que Promise.all pero sin abandonar tareas en vuelo cuando una falla:
 * espera a que TODAS terminen (éxito o error) antes de decidir. Si alguna
 * falló, lanza con los mensajes de TODAS las que fallaron (no solo la
 * primera) -- Promise.all aborta apenas la primera rechaza, perdiendo el
 * resultado de trabajo ya casi terminado en las demás.
 */
export async function mapWithConcurrency<A, B>(
	items: readonly A[],
	concurrency: number,
	fn: (item: A) => Promise<B>,
): Promise<B[]> {
	const results: B[] = new Array(items.length);
	const errors: unknown[] = [];
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			try {
				results[index] = await fn(items[index]);
			} catch (error) {
				errors.push(error);
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, worker),
	);

	if (errors.length > 0) {
		// AggregateError conserva cada error original (tipo, stack, campos
		// propios) en vez de aplanarlos a un solo string -- el caller puede
		// inspeccionar aggregate.errors para distinguir, ej., un timeout de un
		// 503, o loguear el stack real de cada fallo.
		throw new AggregateError(
			errors,
			`mapWithConcurrency: ${errors.length} of ${items.length} tasks failed`,
		);
	}

	return results;
}

export async function fetchAllPages<T>(
	fetchPage: (
		page: number,
	) => Promise<{ data: T[]; totalPages?: number | null }>,
	opts?: { maxPages?: number; concurrency?: number; perPage?: number },
): Promise<T[]> {
	const maxPages = opts?.maxPages ?? 1000;
	const concurrency = opts?.concurrency ?? 10;
	const perPage = opts?.perPage;

	const first = await fetchPage(1);
	const data = [...first.data];

	// Modo "totalPages desconocido": la fuente no reporta totalPages (fetchers
	// legacy). Si el caller pasó `perPage`, se pagina secuencialmente mientras
	// la página venga llena (data.length === perPage) y se corta en la primera
	// página corta -- replica el fallback por longitud clásico. Sin `perPage`
	// no se puede paginar a ciegas, así que se trata como dato corrupto.
	if (first.totalPages == null) {
		if (perPage === undefined) {
			throw new Error(
				`fetchAllPages: response has an invalid totalPages (${first.totalPages}); expected a non-negative integer or a perPage fallback`,
			);
		}

		// Se sigue mientras la última página vino llena (el acumulado equivale a
		// page*perPage exacto). Una página corta rompe la igualdad y corta.
		let page = 1;
		while (data.length === page * perPage && page < maxPages) {
			page += 1;
			const next = await fetchPage(page);
			data.push(...next.data);
		}

		return data;
	}

	// totalPages === 0 es una respuesta válida (sin resultados, ej. ningún
	// crédito en ese estado este mes) -- solo valores negativos o no-enteros
	// son datos corruptos.
	if (!Number.isInteger(first.totalPages) || first.totalPages < 0) {
		throw new Error(
			`fetchAllPages: response has an invalid totalPages (${first.totalPages}); expected a non-negative integer`,
		);
	}

	if (first.totalPages > maxPages) {
		throw new Error(
			`fetchAllPages: totalPages (${first.totalPages}) exceeds maxPages (${maxPages})`,
		);
	}

	const remainingPages = Array.from(
		{ length: Math.max(first.totalPages - 1, 0) },
		(_, i) => i + 2,
	);
	const rest = await mapWithConcurrency(remainingPages, concurrency, (page) =>
		fetchPage(page),
	);

	for (const next of rest) {
		data.push(...next.data);
	}

	return data;
}
