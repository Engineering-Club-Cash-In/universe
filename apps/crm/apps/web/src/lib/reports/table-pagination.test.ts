import { describe, expect, test } from "bun:test";
import { getTablePage } from "./table-pagination";

describe("getTablePage", () => {
	test("limita la tabla a 25 filas y permite llegar a la última página", () => {
		const rows = Array.from({ length: 133 }, (_, index) => index + 1);

		expect(getTablePage(rows, 1)).toEqual({
			rows: rows.slice(0, 25),
			page: 1,
			totalPages: 6,
			from: 1,
			to: 25,
			total: 133,
		});
		expect(getTablePage(rows, 6)).toEqual({
			rows: rows.slice(125),
			page: 6,
			totalPages: 6,
			from: 126,
			to: 133,
			total: 133,
		});
	});

	test("normaliza páginas fuera de rango y colecciones vacías", () => {
		const rows = Array.from({ length: 30 }, (_, index) => index);

		expect(getTablePage(rows, 99).page).toBe(2);
		expect(getTablePage(rows, 0).page).toBe(1);
		expect(getTablePage([], 4)).toEqual({
			rows: [],
			page: 1,
			totalPages: 1,
			from: 0,
			to: 0,
			total: 0,
		});
	});
});
