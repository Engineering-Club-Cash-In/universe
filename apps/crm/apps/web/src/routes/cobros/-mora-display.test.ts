import { describe, expect, test } from "bun:test";
import * as moraDisplay from "./-mora-display";
import { buildMoraDisplayRows, getMoraSnapshotDate } from "./-mora-display";

describe("buildCapitalAging", () => {
	test("calcula acumulados globales y bandas exclusivas por asesor", () => {
		expect("buildCapitalAging" in moraDisplay).toBe(true);
		if (!("buildCapitalAging" in moraDisplay)) return;

		const aging = moraDisplay.buildCapitalAging({
			totales: {
				mora_30: { cantidad: 1, sumaCapital: "100", sumaMora: "10" },
				mora_60: { cantidad: 2, sumaCapital: "200", sumaMora: "20" },
				mora_90: { cantidad: 1, sumaCapital: "50", sumaMora: "5" },
				mora_120_plus: {
					cantidad: 3,
					sumaCapital: "150",
					sumaMora: "15",
				},
			},
			porAsesor: [
				{
					asesorId: 7,
					nombre: "Ana",
					mora_30: { cantidad: 1, sumaCapital: "100", sumaMora: "10" },
					mora_60: { cantidad: 0, sumaCapital: "0", sumaMora: "0" },
					mora_90: { cantidad: 0, sumaCapital: "0", sumaMora: "0" },
					mora_120_plus: {
						cantidad: 1,
						sumaCapital: "40",
						sumaMora: "4",
					},
				},
			],
			capitalCartera: {
				total: "1000",
				porAsesor: [
					{ asesorId: 7, nombre: "Ana", capital: "400" },
					{ asesorId: 8, nombre: "Beto", capital: "600" },
				],
			},
		});

		expect(aging.acumulados).toEqual([
			expect.objectContaining({
				umbral: 30,
				capital: 500,
				cantidad: 7,
				porcentaje: 50,
			}),
			expect.objectContaining({
				umbral: 60,
				capital: 400,
				cantidad: 6,
				porcentaje: 40,
			}),
			expect.objectContaining({
				umbral: 90,
				capital: 200,
				cantidad: 4,
				porcentaje: 20,
			}),
			expect.objectContaining({
				umbral: 120,
				capital: 150,
				cantidad: 3,
				porcentaje: 15,
			}),
		]);
		expect(aging.porAsesor).toEqual([
			expect.objectContaining({
				asesorId: 7,
				capitalCartera: 400,
				mora_30: expect.objectContaining({
					capital: 100,
					cantidad: 1,
					porcentaje: 25,
				}),
				mora_120_plus: expect.objectContaining({
					capital: 40,
					cantidad: 1,
					porcentaje: 10,
				}),
			}),
			expect.objectContaining({ asesorId: 8, capitalCartera: 600 }),
		]);
	});

	test("devuelve porcentajes cero sin denominador", () => {
		expect("buildCapitalAging" in moraDisplay).toBe(true);
		if (!("buildCapitalAging" in moraDisplay)) return;

		const aging = moraDisplay.buildCapitalAging({
			totales: {},
			porAsesor: [],
			capitalCartera: {
				total: "0",
				porAsesor: [{ asesorId: 7, nombre: "Ana", capital: "0" }],
			},
		});

		expect(aging.acumulados.every((item) => item.porcentaje === 0)).toBe(true);
		expect(aging.porAsesor[0]?.mora_30.porcentaje).toBe(0);
	});

	test("marca como indefinido un numerador positivo sin denominador actual", () => {
		const aging = moraDisplay.buildCapitalAging({
			totales: {
				mora_30: { cantidad: 1, sumaCapital: "100", sumaMora: "10" },
			},
			porAsesor: [
				{
					asesorId: 7,
					nombre: "Ana",
					mora_30: { cantidad: 1, sumaCapital: "100", sumaMora: "10" },
				},
			],
			capitalCartera: {
				total: "0",
				porAsesor: [{ asesorId: 7, nombre: "Ana", capital: "0" }],
			},
		});

		expect(aging.acumulados[0]?.porcentaje).toBeNull();
		expect(aging.porAsesor[0]?.mora_30.porcentaje).toBeNull();
	});

	test("conserva ratios superiores a cien sin truncarlos", () => {
		const aging = moraDisplay.buildCapitalAging({
			totales: {
				mora_30: { cantidad: 1, sumaCapital: "120", sumaMora: "10" },
			},
			porAsesor: [],
			capitalCartera: { total: "100", porAsesor: [] },
		});

		expect(aging.acumulados[0]?.porcentaje).toBe(120);
	});

	test("marca como no disponible una respuesta del backend anterior", () => {
		const aging = moraDisplay.buildCapitalAging({
			totales: {},
			porAsesor: [],
		});

		expect(aging.disponible).toBe(false);
	});

	test("no representa como cero un corte anterior a la cobertura histórica", () => {
		const aging = moraDisplay.buildCapitalAging({
			totales: {},
			porAsesor: [],
			capitalCartera: { total: "1000", porAsesor: [] },
			dataDisponibleDesde: "2026-05-19",
		});

		expect(aging.disponible).toBe(false);
		expect(aging.sinCoberturaHistorica).toBe(true);
	});
});

describe("panel de aging de capital", () => {
	test("se integra como panel adicional y declara la asignación actual en histórico", async () => {
		const source = await Bun.file(
			new URL("./reportes.tsx", import.meta.url),
		).text();
		expect(source).toContain("Aging de capital");
		expect(source).toContain("buildCapitalAging");
		expect(source).toMatch(/capital y asesor\s+según asignación\s+actual/);
		expect(source).toContain('? "N/D"');
		expect(source).not.toContain('role="progressbar"');
	});
});

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
