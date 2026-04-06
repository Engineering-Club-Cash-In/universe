import { describe, expect, test } from "bun:test";
import {
	filterCobrosSearchResults,
	matchesCobrosSearch,
	normalizeCobrosSearchValue,
} from "./cobros-search";

describe("cobros search helpers", () => {
	test("normalizes values for flexible plate matching", () => {
		expect(normalizeCobrosSearchValue(" P-123 abc ")).toBe("p123abc");
		expect(normalizeCobrosSearchValue("abc 123")).toBe("abc123");
	});

	test("matches by customer name or flexible vehicle plate", () => {
		expect(
			matchesCobrosSearch(
				{ clienteNombre: "Juan Perez", vehiculoPlaca: "P-123 ABC" },
				"123ab",
			),
		).toBe(true);

		expect(
			matchesCobrosSearch(
				{ clienteNombre: "Maria Lopez", vehiculoPlaca: "QWE-987" },
				"maria",
			),
		).toBe(true);

		expect(
			matchesCobrosSearch(
				{ clienteNombre: "Maria Lopez", vehiculoPlaca: "QWE-987" },
				"zzz",
			),
		).toBe(false);
	});

	test("filters and paginates locally after matching", () => {
		const results = filterCobrosSearchResults(
			[
				{ clienteNombre: "Juan Perez", vehiculoPlaca: "P-123 ABC" },
				{ clienteNombre: "Ana Gomez", vehiculoPlaca: "X-999" },
				{ clienteNombre: "Pedro Ruiz", vehiculoPlaca: "P-456 XYZ" },
			],
			"p",
			0,
			1,
		);

		expect(results.total).toBe(2);
		expect(results.items).toEqual([
			{ clienteNombre: "Juan Perez", vehiculoPlaca: "P-123 ABC" },
		]);
	});
});
