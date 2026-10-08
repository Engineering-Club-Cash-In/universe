import { describe, expect, it } from "bun:test";
import {
	diasHabilesDelMes,
	metaRecuperacionDelRango,
	rangosDesempeno,
	sumarDiasStr,
} from "./desempeno-asesor";

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

describe("metaRecuperacionDelRango (B3, días hábiles L–S)", () => {
	// Octubre 2026: 31 días, 4 domingos → 27 hábiles. Septiembre 2026: 30 días,
	// 4 domingos → 26 hábiles.
	const metas: Record<string, number> = { "2026-9": 26000, "2026-10": 54000 };
	const metaDelMes = (anio: number, mes: number) =>
		metas[`${anio}-${mes}`] ?? null;

	it("cuenta los días hábiles del mes", () => {
		expect(diasHabilesDelMes(2026, 10)).toBe(27);
		expect(diasHabilesDelMes(2026, 9)).toBe(26);
	});

	it("mes: la meta mensual completa", () => {
		expect(
			metaRecuperacionDelRango(
				"mes",
				{ desdeStr: "2026-10-01", hastaStr: "2026-10-06" },
				metaDelMes,
			),
		).toBe(54000);
	});

	it("día hábil: meta del mes / días hábiles", () => {
		expect(
			metaRecuperacionDelRango(
				"dia",
				{ desdeStr: "2026-10-06", hastaStr: "2026-10-06" },
				metaDelMes,
			),
		).toBe(2000);
	});

	it("domingo: sin meta", () => {
		expect(
			metaRecuperacionDelRango(
				"dia",
				{ desdeStr: "2026-10-04", hastaStr: "2026-10-04" },
				metaDelMes,
			),
		).toBeNull();
	});

	it("semana: la meta diaria por cada día hábil transcurrido", () => {
		expect(
			metaRecuperacionDelRango(
				"semana",
				{ desdeStr: "2026-10-05", hastaStr: "2026-10-07" },
				metaDelMes,
			),
		).toBe(6000);
	});

	it("semana que cruza de mes: la meta diaria de cada mes", () => {
		// 28, 29 y 30 sep a 1000 + 1 oct a 2000.
		expect(
			metaRecuperacionDelRango(
				"semana",
				{ desdeStr: "2026-09-28", hastaStr: "2026-10-01" },
				metaDelMes,
			),
		).toBe(5000);
	});

	it("semana que cruza de mes y falta la meta de uno de los meses: null (no una meta parcial)", () => {
		const soloOctubre = (anio: number, mes: number) =>
			anio === 2026 && mes === 10 ? 27000 : null;
		const soloSeptiembre = (anio: number, mes: number) =>
			anio === 2026 && mes === 9 ? 26000 : null;
		const rango = { desdeStr: "2026-09-28", hastaStr: "2026-10-01" };
		expect(metaRecuperacionDelRango("semana", rango, soloOctubre)).toBeNull();
		expect(
			metaRecuperacionDelRango("semana", rango, soloSeptiembre),
		).toBeNull();
	});

	it("semana dentro de un solo mes con su meta: no cambia", () => {
		expect(
			metaRecuperacionDelRango(
				"semana",
				{ desdeStr: "2026-10-05", hastaStr: "2026-10-08" },
				metaDelMes,
			),
		).toBe(8000);
	});

	it("sin meta cargada: null", () => {
		expect(
			metaRecuperacionDelRango(
				"semana",
				{ desdeStr: "2026-11-02", hastaStr: "2026-11-04" },
				metaDelMes,
			),
		).toBeNull();
	});
});
