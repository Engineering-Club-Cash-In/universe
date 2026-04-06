import { describe, expect, test } from "bun:test";
import { filterCobrosSearchResults } from "./cobros-search";

describe("cobros search helpers", () => {
	test("filters by vehicle plate with normalized matching", () => {
		const items = [
			{ vehiculoPlaca: "P-123 ABC" },
			{ vehiculoPlaca: "X-999" },
			{ vehiculoPlaca: "P-456 XYZ" },
		];

		const byPlate = filterCobrosSearchResults(items, "123ab", 0, 10);
		expect(byPlate.total).toBe(1);
		expect(byPlate.items).toEqual([{ vehiculoPlaca: "P-123 ABC" }]);

		const noMatch = filterCobrosSearchResults(items, "zzz", 0, 10);
		expect(noMatch.total).toBe(0);
	});

	test("paginates filtered results", () => {
		const items = [
			{ vehiculoPlaca: "P-123 ABC" },
			{ vehiculoPlaca: "P-456 XYZ" },
			{ vehiculoPlaca: "P-789 DEF" },
		];

		const page = filterCobrosSearchResults(items, "p", 0, 2);
		expect(page.total).toBe(3);
		expect(page.items.length).toBe(2);

		const page2 = filterCobrosSearchResults(items, "p", 2, 2);
		expect(page2.items.length).toBe(1);
	});

	test("returns all items when no search term", () => {
		const items = [{ vehiculoPlaca: "P-123" }, { vehiculoPlaca: "X-999" }];
		const result = filterCobrosSearchResults(items, "", 0, 10);
		expect(result.total).toBe(2);
	});
});
