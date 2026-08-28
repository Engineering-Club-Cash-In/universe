import { describe, expect, test } from "bun:test";
import { agruparPorCuota } from "./pagalo-allocations-view";

describe("agruparPorCuota", () => {
	test("snapshot vacío devuelve lista vacía", () => {
		expect(agruparPorCuota([], [])).toEqual([]);
	});

	test("snapshot no-array devuelve lista vacía", () => {
		expect(agruparPorCuota(null, [])).toEqual([]);
		expect(agruparPorCuota(undefined, [])).toEqual([]);
		expect(agruparPorCuota("no es un array", [])).toEqual([]);
	});

	test("numero_cuota null cae en el grupo sintético Mora", () => {
		const snapshot = [
			{
				link_type: "MORA_INTERES",
				numero_cuota: null,
				rubro: "MORA",
				amount: "150.00",
			},
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado).toHaveLength(1);
		expect(resultado[0].numeroCuota).toBeNull();
		expect(resultado[0].rubros).toEqual([{ rubro: "MORA", amount: "150.00" }]);
	});

	test("dos cuotas con dos rubros cada una, ordenadas por número", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 13,
				rubro: "CAPITAL",
				amount: "500.00",
			},
			{
				link_type: "MORA_INTERES",
				numero_cuota: 13,
				rubro: "INTERES",
				amount: "50.00",
			},
			{
				link_type: "CAPITAL",
				numero_cuota: 12,
				rubro: "CAPITAL",
				amount: "500.00",
			},
			{
				link_type: "MORA_INTERES",
				numero_cuota: 12,
				rubro: "IVA",
				amount: "6.00",
			},
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado.map((c) => c.numeroCuota)).toEqual([12, 13]);
		expect(resultado[0].rubros).toEqual([
			{ rubro: "CAPITAL", amount: "500.00" },
			{ rubro: "IVA", amount: "6.00" },
		]);
		expect(resultado[0].linkTypes.sort()).toEqual(["CAPITAL", "MORA_INTERES"]);
	});

	test("snapshot malformado descarta filas inválidas sin tirar", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 1,
				rubro: "CAPITAL",
				amount: "100.00",
			},
			{ link_type: "CAPITAL", numero_cuota: 2, rubro: "CAPITAL", amount: 100 }, // amount no-string
			{
				link_type: "DESCONOCIDO",
				numero_cuota: 3,
				rubro: "CAPITAL",
				amount: "100.00",
			}, // link_type inválido
			{ numero_cuota: 4, rubro: "CAPITAL", amount: "100.00" }, // sin link_type
			"no es un objeto",
			null,
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado).toHaveLength(1);
		expect(resultado[0].numeroCuota).toBe(1);
	});

	test("link REPLACED + ACTIVE del mismo tipo se separan en histórico y vivo", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 5,
				rubro: "CAPITAL",
				amount: "300.00",
			},
		];
		const links = [
			{
				id: "link-viejo",
				linkType: "CAPITAL" as const,
				status: "REPLACED",
				generation: 1,
			},
			{
				id: "link-nuevo",
				linkType: "CAPITAL" as const,
				status: "ACTIVE",
				generation: 2,
			},
		];
		const resultado = agruparPorCuota(snapshot, links);
		expect(resultado).toHaveLength(1);
		expect(resultado[0].linksVivos.map((l) => l.id)).toEqual(["link-nuevo"]);
		expect(resultado[0].linksHistoricos.map((l) => l.id)).toEqual([
			"link-viejo",
		]);
	});

	test("link PAID sin ninguna regeneración no cuenta como link previo/duplicado", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 7,
				rubro: "CAPITAL",
				amount: "400.00",
			},
		];
		const links = [
			{
				id: "link-pagado",
				linkType: "CAPITAL" as const,
				status: "PAID",
				generation: 1,
			},
		];
		const resultado = agruparPorCuota(snapshot, links);
		expect(resultado).toHaveLength(1);
		expect(resultado[0].linksVivos).toEqual([]);
		expect(resultado[0].linksHistoricos).toEqual([]);
	});
});
