import { describe, expect, test } from "bun:test";
import { construirHistorial, type EventoEtapa } from "./tracker-historial";

const f = (iso: string) => new Date(iso);
const evento = (
	iso: string,
	pctDestino: number,
	pctOrigen: number | null = null,
): EventoEtapa => ({ changedAt: f(iso), pctDestino, pctOrigen });

const CREADO = f("2026-03-01T10:00:00.000Z");

describe("construirHistorial", () => {
	test("sin eventos, sintetiza la etapa actual con la fecha de creación", () => {
		// El 43% de las oportunidades cae aquí: nacieron en 20% y no se movieron.
		const historial = construirHistorial([], {
			createdAt: CREADO,
			closurePercentage: 20,
		});

		expect(historial).toEqual([
			{ paso: 1, porcentaje: 20, fecha: CREADO.toISOString() },
		]);
	});

	test("con eventos, agrega la etapa de origen del primero como entrada inicial", () => {
		const historial = construirHistorial(
			[
				evento("2026-03-05T10:00:00.000Z", 30, 20),
				evento("2026-03-09T10:00:00.000Z", 50, 30),
			],
			{ createdAt: CREADO, closurePercentage: 50 },
		);

		expect(historial).toEqual([
			{ paso: 1, porcentaje: 20, fecha: CREADO.toISOString() },
			{ paso: 2, porcentaje: 30, fecha: "2026-03-05T10:00:00.000Z" },
			{ paso: 3, porcentaje: 50, fecha: "2026-03-09T10:00:00.000Z" },
		]);
	});

	test("un retroceso no pisa la fecha original de la etapa", () => {
		// Pasa de verdad: análisis devuelve el caso y ventas lo vuelve a subir.
		const historial = construirHistorial(
			[
				evento("2026-03-05T10:00:00.000Z", 30, 20),
				evento("2026-03-08T10:00:00.000Z", 20, 30),
				evento("2026-03-20T10:00:00.000Z", 30, 20),
			],
			{ createdAt: CREADO, closurePercentage: 30 },
		);

		const treinta = historial.find((h) => h.porcentaje === 30);
		expect(treinta?.fecha).toBe("2026-03-05T10:00:00.000Z");
	});

	test("no duplica la entrada inicial si el historial ya cubre esa etapa", () => {
		const historial = construirHistorial(
			[evento("2026-03-05T10:00:00.000Z", 20, 20)],
			{ createdAt: CREADO, closurePercentage: 20 },
		);

		expect(historial).toHaveLength(1);
		expect(historial[0].fecha).toBe("2026-03-05T10:00:00.000Z");
	});

	test("ordena por porcentaje aunque los eventos lleguen desordenados", () => {
		const historial = construirHistorial(
			[
				evento("2026-03-09T10:00:00.000Z", 50, 30),
				evento("2026-03-05T10:00:00.000Z", 30, 20),
			],
			{ createdAt: CREADO, closurePercentage: 50 },
		);

		expect(historial.map((h) => h.porcentaje)).toEqual([20, 30, 50]);
	});

	test("tolera from_stage nulo en la primera fila", () => {
		// 2 de 269 filas reales lo tienen: cae al closurePercentage actual.
		const historial = construirHistorial(
			[evento("2026-03-05T10:00:00.000Z", 30, null)],
			{ createdAt: CREADO, closurePercentage: 30 },
		);

		expect(historial).toEqual([
			{ paso: 2, porcentaje: 30, fecha: "2026-03-05T10:00:00.000Z" },
		]);
	});

	test("un caso completo cubre los 5 pasos con sus dos porcentajes", () => {
		const historial = construirHistorial(
			[
				evento("2026-03-02T10:00:00.000Z", 30, 20),
				evento("2026-03-04T10:00:00.000Z", 40, 30),
				evento("2026-03-06T10:00:00.000Z", 50, 40),
				evento("2026-03-08T10:00:00.000Z", 80, 50),
				evento("2026-03-10T10:00:00.000Z", 85, 80),
				evento("2026-03-12T10:00:00.000Z", 90, 85),
				evento("2026-03-14T10:00:00.000Z", 100, 90),
			],
			{ createdAt: CREADO, closurePercentage: 100 },
		);

		expect(historial.map((h) => h.porcentaje)).toEqual([
			20, 30, 40, 50, 80, 85, 90, 100,
		]);
		expect([...new Set(historial.map((h) => h.paso))]).toEqual([1, 2, 3, 4, 5]);
	});

	test("nunca devuelve un historial vacío", () => {
		// Si quedara vacío, el filtro por período haría desaparecer el caso.
		for (const pct of [1, 10, 20, 30, 50, 100]) {
			const historial = construirHistorial([], {
				createdAt: CREADO,
				closurePercentage: pct,
			});
			expect(historial.length).toBeGreaterThan(0);
		}
	});
});
