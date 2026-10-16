import { describe, expect, test } from "bun:test";
import {
	getGuatemalaMonthWindow,
	getUltimosTresMesesGT,
} from "./guatemala-month-window";

describe("getGuatemalaMonthWindow", () => {
	test("returns UTC bounds for the start and end of an April window in Guatemala", () => {
		const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(2026, 4);

		expect(startOfMonth.toISOString()).toBe("2026-04-01T06:00:00.000Z");
		expect(endOfMonth.toISOString()).toBe("2026-05-01T06:00:00.000Z");
	});

	test("handles year boundaries", () => {
		const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(2026, 12);

		expect(startOfMonth.toISOString()).toBe("2026-12-01T06:00:00.000Z");
		expect(endOfMonth.toISOString()).toBe("2027-01-01T06:00:00.000Z");
	});
});

describe("getUltimosTresMesesGT", () => {
	test("devuelve los 3 meses que terminan en el mes elegido, del más viejo al elegido", () => {
		const meses = getUltimosTresMesesGT(2026, 10);

		expect(meses.map(({ year, month }) => ({ year, month }))).toEqual([
			{ year: 2026, month: 8 },
			{ year: 2026, month: 9 },
			{ year: 2026, month: 10 },
		]);
		expect(meses[0].startOfMonth.toISOString()).toBe(
			"2026-08-01T06:00:00.000Z",
		);
		expect(meses[2].endOfMonth.toISOString()).toBe("2026-11-01T06:00:00.000Z");
	});

	test("cruza el límite de año", () => {
		expect(
			getUltimosTresMesesGT(2027, 1).map(({ year, month }) => ({
				year,
				month,
			})),
		).toEqual([
			{ year: 2026, month: 11 },
			{ year: 2026, month: 12 },
			{ year: 2027, month: 1 },
		]);
		expect(
			getUltimosTresMesesGT(2026, 2).map(({ year, month }) => ({
				year,
				month,
			})),
		).toEqual([
			{ year: 2025, month: 12 },
			{ year: 2026, month: 1 },
			{ year: 2026, month: 2 },
		]);
	});

	test("las ventanas son contiguas: el fin de cada mes es el inicio del siguiente", () => {
		const meses = getUltimosTresMesesGT(2026, 1);

		expect(meses[0].endOfMonth.getTime()).toBe(meses[1].startOfMonth.getTime());
		expect(meses[1].endOfMonth.getTime()).toBe(meses[2].startOfMonth.getTime());
	});
});
