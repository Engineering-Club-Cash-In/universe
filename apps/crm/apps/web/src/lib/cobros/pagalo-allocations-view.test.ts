import { describe, expect, test } from "bun:test";
import {
	agruparPorCuota,
	type LinkParaAgrupar,
} from "./pagalo-allocations-view";

describe("agruparPorCuota", () => {
	test("snapshot vacío devuelve lista vacía", () => {
		expect(agruparPorCuota([], [])).toEqual([]);
	});

	test("snapshot no-array devuelve lista vacía", () => {
		expect(agruparPorCuota(null, [])).toEqual([]);
		expect(agruparPorCuota(undefined, [])).toEqual([]);
		expect(agruparPorCuota("no es array", [])).toEqual([]);
	});

	test("numero_cuota null (mora pura, grupo solo-mora) forma un bloque sintético", () => {
		const snapshot = [
			{
				link_type: "MORA_INTERES",
				cartera_cuota_id: null,
				numero_cuota: null,
				rubro: "MORA",
				amount: "150.00",
				facturable: true,
			},
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado).toHaveLength(1);
		expect(resultado[0]?.numeroCuota).toBeNull();
		expect(resultado[0]?.etiqueta).toBe("Mora");
		expect(resultado[0]?.montoTotal).toBe("150.00");
	});

	test("dos cuotas por dos rubros, en orden ascendente", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				cartera_cuota_id: 1,
				numero_cuota: 12,
				rubro: "CAPITAL",
				amount: "1000.00",
				facturable: false,
			},
			{
				link_type: "MORA_INTERES",
				cartera_cuota_id: 1,
				numero_cuota: 12,
				rubro: "INTERES",
				amount: "50.00",
				facturable: true,
			},
			{
				link_type: "CAPITAL",
				cartera_cuota_id: 2,
				numero_cuota: 11,
				rubro: "CAPITAL",
				amount: "900.00",
				facturable: false,
			},
			{
				link_type: "MORA_INTERES",
				cartera_cuota_id: 2,
				numero_cuota: 11,
				rubro: "INTERES",
				amount: "40.00",
				facturable: true,
			},
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado.map((c) => c.numeroCuota)).toEqual([11, 12]);
		expect(resultado[0]?.montoTotal).toBe("940.00");
		expect(resultado[0]?.linkTypes.sort()).toEqual(["CAPITAL", "MORA_INTERES"]);
	});

	test("filas malformadas se descartan sin tirar", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 5,
				rubro: "CAPITAL",
				amount: "100.00",
			},
			{ link_type: "INVALIDO", numero_cuota: 5, rubro: "X", amount: "1.00" },
			{ link_type: "CAPITAL", numero_cuota: 5, rubro: "X", amount: 100 },
			{
				link_type: "CAPITAL",
				numero_cuota: "no-numero",
				rubro: "X",
				amount: "1.00",
			},
			null,
			"texto",
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado).toHaveLength(1);
		expect(resultado[0]?.montoTotal).toBe("100.00");
	});

	test("numero_cuota ausente (undefined, no null) se descarta en vez de formar 'Cuota #undefined'", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				rubro: "CAPITAL",
				amount: "100.00",
				// numero_cuota directamente ausente del objeto — distinto de
				// pasarlo explícito como null (mora pura, sí válido).
			},
			{
				link_type: "MORA_INTERES",
				numero_cuota: null,
				rubro: "MORA",
				amount: "50.00",
			},
		];
		const resultado = agruparPorCuota(snapshot, []);
		expect(resultado).toHaveLength(1);
		expect(resultado[0]?.numeroCuota).toBeNull();
		expect(resultado[0]?.montoTotal).toBe("50.00");
	});

	test("link REPLACED + ACTIVE del mismo tipo: uno activo, uno histórico", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 3,
				cartera_cuota_id: 9,
				rubro: "CAPITAL",
				amount: "500.00",
				facturable: false,
			},
		];
		const links: LinkParaAgrupar[] = [
			{ id: "viejo", linkType: "CAPITAL", status: "REPLACED", generation: 1 },
			{ id: "nuevo", linkType: "CAPITAL", status: "ACTIVE", generation: 2 },
		];
		const resultado = agruparPorCuota(snapshot, links);
		expect(resultado[0]?.linksActivos.map((l) => l.id)).toEqual(["nuevo"]);
		expect(resultado[0]?.linksHistoricos.map((l) => l.id)).toEqual(["viejo"]);
	});

	test("link PAID sin ninguna regeneración no cuenta como link previo/duplicado", () => {
		const snapshot = [
			{
				link_type: "CAPITAL",
				numero_cuota: 7,
				cartera_cuota_id: 20,
				rubro: "CAPITAL",
				amount: "400.00",
				facturable: false,
			},
		];
		const links: LinkParaAgrupar[] = [
			{ id: "link-pagado", linkType: "CAPITAL", status: "PAID", generation: 1 },
		];
		const resultado = agruparPorCuota(snapshot, links);
		expect(resultado[0]?.linksActivos).toEqual([]);
		expect(resultado[0]?.linksHistoricos).toEqual([]);
	});
});
