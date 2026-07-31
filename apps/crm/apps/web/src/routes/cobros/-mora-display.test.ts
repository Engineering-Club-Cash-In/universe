import { describe, expect, test } from "bun:test";
import { buildMoraDisplayRows, getMoraSnapshotDate } from "./-mora-display";

describe("getMoraSnapshotDate", () => {
	test("mantiene Hoy en vivo y usa el cierre del día 5 para meses iniciados", () => {
		expect(getMoraSnapshotDate("hoy", "2026-06", "2026-06-06")).toBeUndefined();
		expect(getMoraSnapshotDate("mes", "2026-06", "2026-06-06")).toBe(
			"2026-06-05",
		);
	});

	test("conserva el provisional antes del día 5 y los límites de año", () => {
		expect(getMoraSnapshotDate("mes", "2026-06", "2026-06-03")).toBe(
			"2026-06-03",
		);
		expect(getMoraSnapshotDate("mes", "2025-12", "2026-01-06")).toBe(
			"2025-12-05",
		);
		expect(getMoraSnapshotDate("mes", "2026-01", "2026-02-06")).toBe(
			"2026-01-05",
		);
	});
});

describe("buildMoraDisplayRows", () => {
	test("conserva Sin asignar y mezcla los buckets completos por asesor", () => {
		const rows = buildMoraDisplayRows(
			[
				{
					asesorId: 7,
					nombre: "Ana",
					totalEnMora: { cantidad: 2, sumaMora: "100.00" },
					mora_30: { cantidad: 1, sumaCapital: "10.00", sumaMora: "20.00" },
					mora_60: { cantidad: 1, sumaCapital: "30.00", sumaMora: "40.00" },
					mora_90: { cantidad: 0, sumaCapital: "0.00", sumaMora: "0.00" },
					mora_120_plus: { cantidad: 0, sumaCapital: "0.00", sumaMora: "0.00" },
				},
			],
			[
				{
					asesorId: 7,
					nombre: "Ana",
					esperado: "100.00",
					cobradoEnSnapshot: "70.00",
					cobradoFueraSnapshot: "5.00",
					excedenteEnSnapshot: "0.00",
					pendiente: "30.00",
				},
				{
					asesorId: null,
					nombre: "Sin asignar",
					esperado: "50.00",
					cobradoEnSnapshot: "20.00",
					cobradoFueraSnapshot: "0.00",
					excedenteEnSnapshot: "0.00",
					pendiente: "30.00",
				},
			],
		);

		expect(rows).toEqual([
			expect.objectContaining({
				asesorId: 7,
				mora_30: { cantidad: 1, sumaCapital: "10.00", sumaMora: "20.00" },
				mora_60: { cantidad: 1, sumaCapital: "30.00", sumaMora: "40.00" },
				pendiente: "30.00",
			}),
			expect.objectContaining({
				asesorId: null,
				nombre: "Sin asignar",
				esperado: "50.00",
				pendiente: "30.00",
			}),
		]);
	});

	test("ignora recuperación cacheada en modo hoy", () => {
		const rows = buildMoraDisplayRows(
			[
				{
					asesorId: 7,
					nombre: "Ana",
					totalEnMora: { cantidad: 1, sumaMora: "100.00" },
				},
			],
			[
				{
					asesorId: 7,
					nombre: "Ana",
					esperado: "999.00",
					cobradoEnSnapshot: "500.00",
					cobradoFueraSnapshot: "0.00",
					excedenteEnSnapshot: "0.00",
					pendiente: "499.00",
				},
			],
			false,
		);

		expect(rows).toEqual([
			expect.objectContaining({
				asesorId: 7,
				esperado: "100.00",
				cobradoEnSnapshot: "0",
				pendiente: "100.00",
			}),
		]);
	});
});
