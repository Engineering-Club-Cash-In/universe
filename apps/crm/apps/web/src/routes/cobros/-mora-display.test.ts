import { describe, expect, test } from "bun:test";
import * as moraDisplay from "./-mora-display";
import {
	buildMoraDisplayRows,
	getCurrentOperationalMonth,
	getMoraSnapshotDate,
	getOfficialClosurePeriod,
	getPreviousMonth,
	normalizeMonthInput,
} from "./-mora-display";

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
		expect(aging.resumen).toEqual({
			capitalMoroso: 500,
			porcentajeCapitalMoroso: 50,
			moraMensualEstimada: 5.6,
		});
		expect(aging.bandas.map((banda) => banda.porcentaje)).toEqual([
			10, 20, 5, 15,
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

	test("usa el monto mensual congelado del cierre oficial", () => {
		const aging = moraDisplay.buildCapitalAging({
			totales: {
				mora_30: { cantidad: 1, sumaCapital: "500", sumaMora: "2000" },
			},
			porAsesor: [],
			capitalCartera: { total: "1000", porAsesor: [] },
			moraMensual: {
				porcentaje: "2.50",
				esperado: "12.50",
				porAsesor: [],
			},
		});

		expect(aging.resumen.moraMensualEstimada).toBe(12.5);
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

describe("getPreviousMonth", () => {
	test("retrocede un mes incluso al cambiar de año", () => {
		expect(getPreviousMonth("2026-08")).toBe("2026-07");
		expect(getPreviousMonth("2026-01")).toBe("2025-12");
	});
});

describe("getOfficialClosurePeriod", () => {
	test("usa el cierre del mes anterior al mes operativo", () => {
		expect(getOfficialClosurePeriod("2026-09")).toBe("2026-08-01");
		expect(getOfficialClosurePeriod("2026-01")).toBe("2025-12-01");
	});

	test("obtiene el mes operativo actual en zona Guatemala", () => {
		expect(getCurrentOperationalMonth(new Date("2026-09-01T05:30:00Z"))).toBe(
			"2026-08",
		);
		expect(getCurrentOperationalMonth(new Date("2026-09-01T06:30:00Z"))).toBe(
			"2026-09",
		);
	});
});

describe("jerarquía del reporte de mora", () => {
	test("prioriza cierre y comparación con términos comprensibles", async () => {
		const source = await Bun.file(
			new URL("./reportes.tsx", import.meta.url),
		).text();
		expect(source).toContain("Cierre de capital en mora");
		expect(source).toContain("Comparar cierres");
		expect(source).toContain("Detalle por asesor");
		expect(source).not.toContain("Aging de capital");
		expect(source).not.toContain("Bandas exclusivas por asesor");
		expect(source).toContain("orpc.getCierreMoraOficial.queryOptions");
		expect(source).toContain("cierre oficial importado");
		expect(source).toContain("capitalAging.resumen.moraMensualEstimada");
		expect(source).not.toContain("recuperacion?.totales.esperado");
		expect(source).toContain("verCobrado || porAsesor.length > 0");
		expect(source).toContain('? "N/D"');
		expect(source).not.toContain('role="progressbar"');
	});

	test("compara y etiqueta exactamente los meses seleccionados", async () => {
		const source = await Bun.file(
			new URL("./reportes.tsx", import.meta.url),
		).text();
		expect(source).toContain("? getOfficialClosurePeriod(mesAnioValido)");
		expect(source).toMatch(
			/const periodoComparacion = `\$\{mesComparacionValido\}-01`;/,
		);
		expect(source).toContain("{fmtMonth(mesComparacionValido)}");
		expect(source).toContain("{fmtMonth(mesAnioValido)}");
	});

	test("normaliza el input del mes principal antes de persistirlo", async () => {
		const source = await Bun.file(
			new URL("./reportes.tsx", import.meta.url),
		).text();
		const valueIndex = source.indexOf("value={mesAnioValido}");
		expect(valueIndex).toBeGreaterThan(-1);
		const inputStart = source.lastIndexOf("<Input", valueIndex);
		const inputEnd = source.indexOf("/>", valueIndex);
		const input = source.slice(inputStart, inputEnd + 2);
		expect(input).toContain('type="month"');
		expect(input).toContain('aria-label="Mes"');
		expect(input).toContain("max={getCurrentOperationalMonth()}");
		expect(input).toContain(
			"setMesAnio(normalizeMonthInput(e.target.value, mesAnioValido))",
		);
	});

	test("ignora cuando se limpia el mes de comparación", async () => {
		const source = await Bun.file(
			new URL("./reportes.tsx", import.meta.url),
		).text();
		expect(source).toContain(
			"if (event.target.value) setMesComparacion(event.target.value);",
		);
	});
});

describe("getMoraSnapshotDate", () => {
	test("mantiene Hoy en vivo y cierra meses anteriores al último día", () => {
		expect(getMoraSnapshotDate("hoy", "2026-06", "2026-09-15")).toBeUndefined();
		expect(getMoraSnapshotDate("mes", "2026-08", "2026-09-15")).toBe(
			"2026-08-31",
		);
	});

	test("usa hoy para el mes abierto y respeta años bisiestos", () => {
		expect(getMoraSnapshotDate("mes", "2026-09", "2026-09-15")).toBe(
			"2026-09-15",
		);
		expect(getMoraSnapshotDate("mes", "2024-02", "2024-03-06")).toBe(
			"2024-02-29",
		);
	});
});

describe("normalizeMonthInput", () => {
	test("recupera un mes vacío o inválido persistido", () => {
		expect(normalizeMonthInput("", "2026-08")).toBe("2026-08");
		expect(normalizeMonthInput("2026-13", "2026-08")).toBe("2026-08");
		expect(normalizeMonthInput("2026-07", "2026-08")).toBe("2026-07");
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

	test("usa el esperado oficial por asesor y recalcula pendiente o excedente", () => {
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
					esperado: "100.00",
					cobradoEnSnapshot: "12.00",
					cobradoFueraSnapshot: "3.00",
					excedenteEnSnapshot: "0.00",
					pendiente: "88.00",
				},
			],
			true,
			[{ asesorId: 7, nombre: "Ana", esperado: "10.00" }],
		);

		expect(rows[0]).toMatchObject({
			esperado: "10.00",
			excedenteEnSnapshot: "2.00",
			pendiente: "0.00",
		});
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
