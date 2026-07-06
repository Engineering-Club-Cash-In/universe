import { describe, expect, test } from "bun:test";
import { recalculateCobrosCapitalPercentages } from "./cobros-capital-percentages";

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
