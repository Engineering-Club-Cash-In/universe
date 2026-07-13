import { describe, expect, test } from "bun:test";
import {
	deriveHasCapitalData,
	recalculateCobrosCapitalPercentages,
	recalculateCobrosPercentagesWithFallback,
} from "./cobros-capital-percentages";

describe("cobros capital percentages", () => {
	test("calculates active mora percentages from capital only", () => {
		const stats = recalculateCobrosCapitalPercentages([
			{
				estadoMora: "al_dia",
				totalCases: 795,
				montoTotal: "0",
				sumaCapital: "89438266.55",
				porcentaje: "51.9",
			},
			{
				estadoMora: "mora_30",
				totalCases: 431,
				montoTotal: "0",
				sumaCapital: "40729880.38",
				porcentaje: "28.1",
			},
			{
				estadoMora: "mora_60",
				totalCases: 139,
				montoTotal: "0",
				sumaCapital: "13087520.98",
				porcentaje: "9.1",
			},
			{
				estadoMora: "mora_90",
				totalCases: 46,
				montoTotal: "0",
				sumaCapital: "4329427.08",
				porcentaje: "3.0",
			},
			{
				estadoMora: "mora_120",
				totalCases: 120,
				montoTotal: "0",
				sumaCapital: "13250798.62",
				porcentaje: "7.8",
			},
			{
				estadoMora: "incobrable",
				totalCases: 43,
				montoTotal: "0",
				sumaCapital: "2070165.08",
				porcentaje: "48.9",
			},
			{
				estadoMora: "completado",
				totalCases: 45,
				montoTotal: "0",
				sumaCapital: "607799.01",
				porcentaje: "51.1",
			},
		]);

		const porcentaje = (estadoMora: string) =>
			Number(stats.find((stat) => stat.estadoMora === estadoMora)?.porcentaje);
		const moraTotal = ["mora_30", "mora_60", "mora_90", "mora_120"].reduce(
			(sum, estadoMora) => sum + porcentaje(estadoMora),
			0,
		);

		expect(porcentaje("al_dia")).toBeCloseTo(55.61, 2);
		expect(porcentaje("mora_30")).toBeCloseTo(25.32, 2);
		expect(porcentaje("mora_60")).toBeCloseTo(8.14, 2);
		expect(porcentaje("mora_90")).toBeCloseTo(2.69, 2);
		expect(porcentaje("mora_120")).toBeCloseTo(8.24, 2);
		expect(moraTotal).toBeCloseTo(44.39, 2);
		expect(porcentaje("incobrable")).toBe(48.9);
		expect(porcentaje("completado")).toBe(51.1);
	});
});

describe("cobros percentages with fallback", () => {
	test("uses capital-based percentages when capital is present", () => {
		const input = [
			{
				estadoMora: "al_dia",
				totalCases: 795,
				montoTotal: "0",
				sumaCapital: "89438266.55",
				porcentaje: "0",
			},
			{
				estadoMora: "mora_30",
				totalCases: 431,
				montoTotal: "0",
				sumaCapital: "40729880.38",
				porcentaje: "0",
			},
		];

		const byCapital = recalculateCobrosCapitalPercentages(input);
		const withFallback = recalculateCobrosPercentagesWithFallback(input, true);

		expect(withFallback).toEqual(byCapital);
	});

	test("uses capital-based percentages (all zero) when hasCapitalData is true", () => {
		const stats = recalculateCobrosPercentagesWithFallback(
			[
				{
					estadoMora: "al_dia",
					totalCases: 60,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				{
					estadoMora: "mora_30",
					totalCases: 40,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
			],
			true,
		);

		const porcentaje = (estadoMora: string) =>
			stats.find((stat) => stat.estadoMora === estadoMora)?.porcentaje;

		// Capital real es 0 (no dato faltante) -> debe mostrar 0%, NO caer a
		// porcentaje por número de casos.
		expect(porcentaje("al_dia")).toBe("0");
		expect(porcentaje("mora_30")).toBe("0");
	});

	test("falls back to percentage by case count when hasCapitalData is false", () => {
		const stats = recalculateCobrosPercentagesWithFallback(
			[
				{
					estadoMora: "al_dia",
					totalCases: 60,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				{
					estadoMora: "mora_30",
					totalCases: 40,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				{
					estadoMora: "mora_60",
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
			],
			false,
		);

		const porcentaje = (estadoMora: string) =>
			stats.find((stat) => stat.estadoMora === estadoMora)?.porcentaje;

		expect(porcentaje("al_dia")).toBe("60.00");
		expect(porcentaje("mora_30")).toBe("40.00");
		expect(porcentaje("mora_60")).toBe("0.00");
	});

	test("returns all zero percentages when neither capital nor cases exist", () => {
		const stats = recalculateCobrosPercentagesWithFallback(
			[
				{
					estadoMora: "al_dia",
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				{
					estadoMora: "mora_30",
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
			],
			false,
		);

		const porcentaje = (estadoMora: string) =>
			stats.find((stat) => stat.estadoMora === estadoMora)?.porcentaje;

		expect(porcentaje("al_dia")).toBe("0");
		expect(porcentaje("mora_30")).toBe("0");
	});

	test("only counts active estados in the case-count denominator", () => {
		const stats = recalculateCobrosPercentagesWithFallback(
			[
				{
					estadoMora: "al_dia",
					totalCases: 30,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				{
					estadoMora: "incobrable",
					totalCases: 70,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
			],
			false,
			new Set(["al_dia"]),
		);

		const porcentaje = (estadoMora: string) =>
			stats.find((stat) => stat.estadoMora === estadoMora)?.porcentaje;

		expect(porcentaje("al_dia")).toBe("100.00");
		expect(porcentaje("incobrable")).toBe("0");
	});
});

describe("deriveHasCapitalData", () => {
	test("true when every active bucket brought a raw sumaCapital value", () => {
		const result = deriveHasCapitalData(
			[
				{ estadoMora: "al_dia", sumaCapital: "100" },
				{ estadoMora: "mora_30", sumaCapital: "0" },
			],
			new Set(["al_dia", "mora_30"]),
		);

		expect(result).toBe(true);
	});

	test("false when even one active bucket is missing sumaCapital (partial payload, not all-or-nothing by 'any')", () => {
		const result = deriveHasCapitalData(
			[
				{ estadoMora: "al_dia", sumaCapital: "100" },
				{ estadoMora: "mora_30", sumaCapital: undefined },
			],
			new Set(["al_dia", "mora_30"]),
		);

		// Antes el bug declaraba true con que UN bucket trajera capital; esto
		// mezclaba mora_30 (capital real desconocido) como si fuera capital=0
		// real, distorsionando el % sin activar el badge de "datos parciales".
		expect(result).toBe(false);
	});

	test("false when sumaCapital is null on an active bucket", () => {
		const result = deriveHasCapitalData(
			[{ estadoMora: "al_dia", sumaCapital: null }],
			new Set(["al_dia"]),
		);

		expect(result).toBe(false);
	});

	test("false when sumaCapital is an empty string (present but no real value)", () => {
		const result = deriveHasCapitalData(
			[{ estadoMora: "al_dia", sumaCapital: "" }],
			new Set(["al_dia"]),
		);

		// "" pasa != null pero no es un valor de capital real -- si se cuela
		// como "true", Number("" || 0) lo trata como capital=0 real más
		// adelante, resucitando el mismo bug de fondo en un caso borde distinto.
		expect(result).toBe(false);
	});

	test("ignores buckets outside activeEstados when deciding", () => {
		const result = deriveHasCapitalData(
			[
				{ estadoMora: "al_dia", sumaCapital: "100" },
				{ estadoMora: "otro_no_activo", sumaCapital: undefined },
			],
			new Set(["al_dia"]),
		);

		expect(result).toBe(true);
	});

	test("false when there are no active buckets at all", () => {
		const result = deriveHasCapitalData([], new Set(["al_dia"]));

		expect(result).toBe(false);
	});
});
