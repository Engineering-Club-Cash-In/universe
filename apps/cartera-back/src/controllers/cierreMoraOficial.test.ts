import { describe, expect, test } from "bun:test";
import {
	findOfficialSummarySheetName,
	parseOfficialAdvisorSummaryMatrix,
	parseOfficialClosureMatrix,
	summarizeOfficialAdvisorClosure,
} from "./cierreMoraOficial";

test("encuentra la hoja ejecutiva sin fijar el mes", () => {
	expect(
		findOfficialSummarySheetName([
			"Listado de moras",
			"Cierre - Cobros Septiembre 2026",
		]),
	).toBe("Cierre - Cobros Septiembre 2026");
});

const advisorIds = new Map([
	["Asesora Uno", 7],
	["Asesor Dos", 8],
]);
const resolveAdvisorId = (name: string) => advisorIds.get(name);

describe("parseOfficialClosureMatrix", () => {
	test("lee la clasificación final sin conservar datos del cliente", () => {
		const rows = parseOfficialClosureMatrix(
			[
				[
					"Asesor",
					"Numero de credito",
					"Nombre",
					"Capital",
					"mora 30 días",
					"mora 60 días",
					"mora 90 días",
					"MORA 120 días",
					"Mora",
					"Tipo de ajuste",
				],
				[
					"Asesora Uno",
					"000123",
					"Ignorado",
					100.125,
					100.125,
					null,
					null,
					null,
					"Mora 30",
					null,
				],
				[
					"Asesor Dos",
					"CRM-fixture",
					"Ignorado",
					200,
					null,
					null,
					null,
					null,
					"Al día",
					null,
				],
			],
			resolveAdvisorId,
		);

		expect(rows).toEqual([
			{ asesorId: 7, asesorNombre: "Asesora Uno", clasificacion: "MORA_30" },
			{ asesorId: 8, asesorNombre: "Asesor Dos", clasificacion: "AL_DIA" },
		]);
	});
});

describe("parseOfficialAdvisorSummaryMatrix", () => {
	test("toma los montos del cuadro sin ajustes y los conteos del detalle", () => {
		const detail = parseOfficialClosureMatrix(
			[
				[
					"Asesor",
					"Numero de credito",
					"Nombre",
					"Capital",
					"mora 30 días",
					"mora 60 días",
					"mora 90 días",
					"MORA 120 días",
					"Mora",
				],
				["Asesora Uno", "1", "Ignorado", 100, 100, null, null, null, "Mora 30"],
				["Asesora Uno", "2", "Ignorado", 200, null, 200, null, null, "Mora 60"],
				["Asesor Dos", "3", "Ignorado", 300, null, null, null, null, "Al día"],
			],
			resolveAdvisorId,
		);
		const rows = parseOfficialAdvisorSummaryMatrix(
			[
				["Asesor", "Capital", "Mora 30", "Mora 60", "Mora 90", "Mora 120"],
				["Asesora Uno", 999, 999, 0, 0, 0],
				["Asesor Dos", 999, 0, 999, 0, 0],
				["Total", 1998, 999, 999, 0, 0],
				[null, "Datos sin ajustes"],
				[
					null,
					"Asesor",
					"Capital",
					"Mora 30",
					"Mora 60",
					"Mora 90",
					"Mora 120",
				],
				[null, "Asesora Uno", 300, 100, 200, 0, 0],
				[null, "Asesor Dos", 300, 0, 0, 0, 0],
				[null, "Total", 600, 100, 200, 0, 0],
			],
			detail,
			resolveAdvisorId,
		);

		expect(rows).toEqual([
			{
				asesorId: 7,
				asesorNombre: "Asesora Uno",
				capital: "300",
				mora30: "100",
				mora60: "200",
				mora90: "0",
				mora120: "0",
				cantidadMora30: 1,
				cantidadMora60: 1,
				cantidadMora90: 0,
				cantidadMora120: 0,
			},
			{
				asesorId: 8,
				asesorNombre: "Asesor Dos",
				capital: "300",
				mora30: "0",
				mora60: "0",
				mora90: "0",
				mora120: "0",
				cantidadMora30: 0,
				cantidadMora60: 0,
				cantidadMora90: 0,
				cantidadMora120: 0,
			},
		]);
	});
});

describe("summarizeOfficialAdvisorClosure", () => {
	test("calcula el global desde las mismas filas por asesor", () => {
		const summary = summarizeOfficialAdvisorClosure("2026-08-01", [
			{
				asesorId: 7,
				asesorNombre: "Asesora Uno",
				capital: "300",
				mora30: "100",
				mora60: "50",
				mora90: "0",
				mora120: "0",
				cantidadMora30: 1,
				cantidadMora60: 1,
				cantidadMora90: 0,
				cantidadMora120: 0,
			},
			{
				asesorId: 8,
				asesorNombre: "Asesor Dos",
				capital: "700",
				mora30: "0",
				mora60: "0",
				mora90: "25",
				mora120: "75",
				cantidadMora30: 0,
				cantidadMora60: 0,
				cantidadMora90: 1,
				cantidadMora120: 1,
			},
		]);

		expect(summary.capitalCartera.total).toBe("1000.00");
		expect(summary.totales.mora_30).toMatchObject({
			cantidad: 1,
			sumaCapital: "100.00",
		});
		expect(summary.totales.mora_120_plus).toMatchObject({
			cantidad: 1,
			sumaCapital: "75.00",
		});
		expect(summary.metadata).toEqual({ fuente: "oficial", inmutable: true });
	});
});
