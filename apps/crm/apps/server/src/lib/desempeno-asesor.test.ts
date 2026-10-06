import { describe, expect, it } from "bun:test";
import { rangosDesempeno, sumarDiasStr } from "./desempeno-asesor";

// Martes 2026-10-06, 15:00 hora Guatemala.
const AHORA = new Date("2026-10-06T21:00:00Z");

describe("rangosDesempeno", () => {
	it("día: hoy contra ayer", () => {
		const { actual, anterior } = rangosDesempeno("dia", AHORA);
		expect([actual.desdeStr, actual.hastaStr]).toEqual([
			"2026-10-06",
			"2026-10-06",
		]);
		expect([anterior.desdeStr, anterior.hastaStr]).toEqual([
			"2026-10-05",
			"2026-10-05",
		]);
		expect(actual.hasta.getTime() - actual.desde.getTime()).toBe(
			24 * 3600 * 1000,
		);
	});

	it("semana: lunes a hoy contra el mismo tramo de la semana anterior", () => {
		const { actual, anterior } = rangosDesempeno("semana", AHORA);
		expect([actual.desdeStr, actual.hastaStr]).toEqual([
			"2026-10-05",
			"2026-10-06",
		]);
		expect([anterior.desdeStr, anterior.hastaStr]).toEqual([
			"2026-09-28",
			"2026-09-29",
		]);
	});

	it("semana: el domingo cierra la semana que empezó el lunes", () => {
		const domingo = new Date("2026-10-11T18:00:00Z");
		const { actual } = rangosDesempeno("semana", domingo);
		expect([actual.desdeStr, actual.hastaStr]).toEqual([
			"2026-10-05",
			"2026-10-11",
		]);
	});

	it("mes: del 1 a hoy contra el mismo tramo del mes anterior, recortado", () => {
		const { actual, anterior } = rangosDesempeno("mes", AHORA);
		expect([actual.desdeStr, actual.hastaStr]).toEqual([
			"2026-10-01",
			"2026-10-06",
		]);
		expect([anterior.desdeStr, anterior.hastaStr]).toEqual([
			"2026-09-01",
			"2026-09-06",
		]);
		const fin = rangosDesempeno("mes", new Date("2026-03-31T18:00:00Z"));
		expect(fin.anterior.hastaStr).toBe("2026-02-28");
		const enero = rangosDesempeno("mes", new Date("2026-01-15T18:00:00Z"));
		expect(enero.anterior.desdeStr).toBe("2025-12-01");
	});

	it("sumarDiasStr cruza meses y años", () => {
		expect(sumarDiasStr("2026-01-01", -1)).toBe("2025-12-31");
		expect(sumarDiasStr("2026-02-28", 1)).toBe("2026-03-01");
	});
});
