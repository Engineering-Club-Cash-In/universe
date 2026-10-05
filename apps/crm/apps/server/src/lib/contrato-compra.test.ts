import { describe, expect, test } from "bun:test";
import { compraDelContrato, conMarcaDeCompra } from "./contrato-compra";

describe("de qué compra es un contrato", () => {
	test("la marca se lee igual que se escribió, sin tocar lo demás", () => {
		const respuesta = conMarcaDeCompra(
			{ documentID: "doc-1", subidoAMano: true },
			new Date("2026-09-17T17:08:00.000Z"),
		);

		expect(respuesta).toMatchObject({ documentID: "doc-1", subidoAMano: true });
		expect(compraDelContrato(respuesta)).toBe("2026-09-17T17:08:00.000Z");
	});

	test("los de antes de la marca no tienen compra", () => {
		expect(compraDelContrato({ documentID: "doc-1" })).toBeNull();
		expect(compraDelContrato(null)).toBeNull();
		expect(compraDelContrato({ compraAceptadaEn: "no es fecha" })).toBeNull();
	});
});
