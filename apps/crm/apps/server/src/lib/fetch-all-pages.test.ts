import { describe, expect, test } from "bun:test";
import { fetchAllPages } from "./fetch-all-pages";

describe("fetchAllPages", () => {
	test("returns data from a single page", async () => {
		const fetchPage = async (page: number) => {
			expect(page).toBe(1);
			return { data: ["a", "b"], totalPages: 1 };
		};

		const result = await fetchAllPages(fetchPage);

		expect(result).toEqual(["a", "b"]);
	});

	test("concatenates data across multiple pages in result order, regardless of fetch order", async () => {
		const pages: Record<number, string[]> = {
			1: ["a", "b"],
			2: ["c", "d"],
			3: ["e"],
		};
		const calledPages: number[] = [];

		const fetchPage = async (page: number) => {
			calledPages.push(page);
			return { data: pages[page] ?? [], totalPages: 3 };
		};

		const result = await fetchAllPages(fetchPage);

		// El resultado siempre respeta el orden de página 1..N...
		expect(result).toEqual(["a", "b", "c", "d", "e"]);
		// ...aunque las páginas 2..N se pidan en paralelo (no garantiza orden de llamada).
		expect(new Set(calledPages)).toEqual(new Set([1, 2, 3]));
		expect(calledPages).toHaveLength(3);
	});

	test("fetches pages 2..N concurrently instead of one at a time", async () => {
		let inFlight = 0;
		let maxInFlight = 0;

		const fetchPage = async (page: number) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return { data: [page], totalPages: 4 };
		};

		await fetchAllPages(fetchPage);

		// Páginas 2, 3, 4 deben solaparse en vuelo (no una request a la vez).
		expect(maxInFlight).toBeGreaterThan(1);
	});

	test("returns empty array without looping when there is no data", async () => {
		let calls = 0;
		const fetchPage = async () => {
			calls += 1;
			return { data: [], totalPages: 1 };
		};

		const result = await fetchAllPages(fetchPage);

		expect(result).toEqual([]);
		expect(calls).toBe(1);
	});

	test("throws instead of looping forever when totalPages exceeds maxPages", async () => {
		const fetchPage = async (page: number) => ({
			data: [page],
			totalPages: 5000,
		});

		await expect(fetchAllPages(fetchPage, { maxPages: 10 })).rejects.toThrow(
			/maxPages/,
		);
	});

	test("throws on a malformed totalPages instead of silently returning page 1", async () => {
		const malformedValues = [Number.NaN, undefined, null, "3", -1];

		for (const totalPages of malformedValues) {
			const fetchPage = async () =>
				({ data: ["a"], totalPages }) as { data: string[]; totalPages: number };

			await expect(fetchAllPages(fetchPage)).rejects.toThrow(/totalPages/);
		}
	});

	test("caps concurrent in-flight requests at the configured limit", async () => {
		let inFlight = 0;
		let maxInFlight = 0;

		const fetchPage = async (page: number) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return { data: [page], totalPages: 20 };
		};

		await fetchAllPages(fetchPage, { concurrency: 3 });

		expect(maxInFlight).toBeLessThanOrEqual(3);
	});

	test("returns an empty array when totalPages is 0 (no results, not an error)", async () => {
		let calls = 0;
		const fetchPage = async () => {
			calls += 1;
			return { data: [], totalPages: 0 };
		};

		const result = await fetchAllPages(fetchPage);

		expect(result).toEqual([]);
		expect(calls).toBe(1);
	});

	test("lets in-flight pages finish instead of abandoning them when one page fails", async () => {
		const finishedFromPool: number[] = [];

		const fetchPage = async (page: number) => {
			if (page === 1) return { data: [1], totalPages: 4 };
			if (page === 2) {
				// La página 2 falla rápido, antes que las demás.
				throw new Error("page 2 boom");
			}
			await new Promise((resolve) => setTimeout(resolve, 15));
			finishedFromPool.push(page);
			return { data: [page], totalPages: 4 };
		};

		let caught: unknown;
		try {
			await fetchAllPages(fetchPage, { concurrency: 4 });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(AggregateError);
		expect((caught as AggregateError).errors[0]).toMatchObject({
			message: "page 2 boom",
		});

		// Las páginas 3 y 4 (parte del pool paralelo, junto a la 2 que falla)
		// debieron terminar de ejecutarse -- no abortadas a medio camino solo
		// porque la página 2 falló primero.
		expect(new Set(finishedFromPool)).toEqual(new Set([3, 4]));
	});

	test("reports every failed page, not just the first one", async () => {
		const fetchPage = async (page: number) => {
			if (page === 2) throw new Error("page 2 boom");
			if (page === 3) throw new Error("page 3 boom");
			return { data: [page], totalPages: 4 };
		};

		let caught: unknown;
		try {
			await fetchAllPages(fetchPage);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(AggregateError);
		const messages = (caught as AggregateError).errors.map(
			(e: Error) => e.message,
		);
		expect(new Set(messages)).toEqual(new Set(["page 2 boom", "page 3 boom"]));
	});

	test("paginates by page length when totalPages is absent and perPage is given", async () => {
		const pages: Record<number, string[]> = {
			1: ["a", "b"],
			2: ["c", "d"],
			3: ["e"],
		};
		const calledPages: number[] = [];

		const fetchPage = async (page: number) => {
			calledPages.push(page);
			return { data: pages[page] ?? [] };
		};

		const result = await fetchAllPages(fetchPage, { perPage: 2 });

		// Sin totalPages, sigue mientras la página venga llena (===perPage) y
		// corta en la página corta [e] (length 1 < 2).
		expect(result).toEqual(["a", "b", "c", "d", "e"]);
		expect(calledPages).toEqual([1, 2, 3]);
	});

	test("stops after one page when the first page is already short (length-based)", async () => {
		let calls = 0;
		const fetchPage = async () => {
			calls += 1;
			return { data: ["a"] };
		};

		const result = await fetchAllPages(fetchPage, { perPage: 2 });

		expect(result).toEqual(["a"]);
		expect(calls).toBe(1);
	});

	test("throws when totalPages is absent and no perPage fallback is configured", async () => {
		const fetchPage = async () => ({ data: ["a"] });

		await expect(fetchAllPages(fetchPage)).rejects.toThrow(/totalPages/);
	});

	test("preserves the original error objects (not just flattened messages)", async () => {
		class CustomFetchError extends Error {
			constructor(
				message: string,
				readonly statusCode: number,
			) {
				super(message);
				this.name = "CustomFetchError";
			}
		}

		const fetchPage = async (page: number) => {
			if (page === 2) throw new CustomFetchError("page 2 boom", 503);
			return { data: [page], totalPages: 2 };
		};

		let caught: unknown;
		try {
			await fetchAllPages(fetchPage);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(AggregateError);
		const aggregate = caught as AggregateError;
		expect(aggregate.errors).toHaveLength(1);
		expect(aggregate.errors[0]).toBeInstanceOf(CustomFetchError);
		// La causa original conserva su tipo y campos propios, no solo el
		// .message aplanado a string -- útil para distinguir un timeout de un
		// 503 en el caller, o para loguear el stack real.
		expect((aggregate.errors[0] as CustomFetchError).statusCode).toBe(503);
	});
});
