import { describe, expect, test } from "bun:test";
import {
	agruparCartas,
	cartasDelPaquete,
	PAQUETE_CARTAS,
	tiposQueReemplaza,
} from "./paquete-cartas";

const firmantes = [
	{ role: "TITULAR", email: "t@x", name: "T" },
	{ role: "COFIRMANTE", email: "c@x", name: "C" },
	{ role: "REP_LEGAL", email: "r@x", name: "R" },
];

const pedido = (contractType: string) => ({
	contractType,
	data: { nombreCompleto: `datos de ${contractType}` },
	signers: firmantes,
	options: { gender: "male", generatePdf: true, filenamePrefix: "Cliente" },
});

describe("agruparCartas", () => {
	test("las cartas se vuelven un solo paquete, en el lugar de la primera", () => {
		const agrupados = agruparCartas([
			pedido("reconocimiento_deuda_feb_2025"),
			pedido("carta_emision_cheques"),
			pedido("garantia_mobiliaria"),
			pedido("cobertura_inrexsa"),
		]);

		expect(agrupados.map((c) => c.contractType)).toEqual([
			"reconocimiento_deuda_feb_2025",
			PAQUETE_CARTAS,
			"garantia_mobiliaria",
		]);
	});

	test("el paquete trae cada carta con sus propios datos, en orden", () => {
		const [paquete] = agruparCartas([
			pedido("carta_emision_cheques"),
			pedido("cobertura_inrexsa"),
		]);

		expect("cartas" in paquete && paquete.cartas).toEqual([
			{
				contractType: "carta_emision_cheques",
				data: { nombreCompleto: "datos de carta_emision_cheques" },
				options: pedido("x").options,
			},
			{
				contractType: "cobertura_inrexsa",
				data: { nombreCompleto: "datos de cobertura_inrexsa" },
				options: pedido("x").options,
			},
		]);
	});

	test("el representante legal no firma el paquete", () => {
		const [paquete] = agruparCartas([pedido("carta_emision_cheques")]);
		expect(paquete.signers?.map((s) => s.role)).toEqual([
			"TITULAR",
			"COFIRMANTE",
		]);
	});

	test("sin cartas, la lista queda igual", () => {
		const contratos = [
			pedido("garantia_mobiliaria"),
			pedido("pagare_unico_libre_protesto"),
		];
		expect(agruparCartas(contratos)).toBe(contratos);
	});

	test("el descargo de responsabilidades no se une: no es una carta", () => {
		const agrupados = agruparCartas([
			pedido("descargo_responsabilidades"),
			pedido("carta_emision_cheques"),
		]);
		expect(agrupados.map((c) => c.contractType)).toEqual([
			"descargo_responsabilidades",
			PAQUETE_CARTAS,
		]);
	});

	test("la declaración de vendedor tampoco: se firma en papel", () => {
		const agrupados = agruparCartas([
			pedido("declaracion_vendedor"),
			pedido("carta_carro_nuevo"),
		]);
		expect(agrupados.map((c) => c.contractType)).toEqual([
			"declaracion_vendedor",
			PAQUETE_CARTAS,
		]);
	});
});

describe("tiposQueReemplaza", () => {
	test("un contrato común reemplaza sólo a los de su tipo", () => {
		expect(tiposQueReemplaza("garantia_mobiliaria")).toEqual([
			"garantia_mobiliaria",
		]);
	});

	test("el paquete reemplaza al paquete anterior y a las cartas sueltas que trae", () => {
		expect(
			tiposQueReemplaza(PAQUETE_CARTAS, [
				"carta_emision_cheques",
				"cobertura_inrexsa",
			]),
		).toEqual([PAQUETE_CARTAS, "carta_emision_cheques", "cobertura_inrexsa"]);
	});

	test("una carta suelta que el paquete no trae se queda donde está", () => {
		const tipos = tiposQueReemplaza(PAQUETE_CARTAS, ["carta_emision_cheques"]);
		expect(tipos).not.toContain("carta_carro_nuevo");
	});

	test("lo que no es carta no se cuela en el reemplazo", () => {
		expect(tiposQueReemplaza(PAQUETE_CARTAS, ["garantia_mobiliaria"])).toEqual([
			PAQUETE_CARTAS,
		]);
	});
});

describe("cartasDelPaquete", () => {
	test("lee las cartas de la respuesta guardada del generador", () => {
		expect(
			cartasDelPaquete({
				cartas: [
					{
						contractType: "carta_emision_cheques",
						label: "Cheques",
						paginas: 1,
					},
				],
			}),
		).toEqual([
			{ contractType: "carta_emision_cheques", label: "Cheques", paginas: 1 },
		]);
	});

	test("un contrato común no trae cartas", () => {
		expect(cartasDelPaquete({ documentID: "x" })).toEqual([]);
		expect(cartasDelPaquete(null)).toEqual([]);
	});
});
