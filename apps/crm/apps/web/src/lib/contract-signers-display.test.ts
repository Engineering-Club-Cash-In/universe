import { describe, expect, test } from "bun:test";
import {
	type FirmanteDeContrato,
	firmantesEnFicha,
} from "./contract-signers-display";

const SIN_LINKS_VIEJOS = {
	clientSigningLink: null,
	representativeSigningLink: null,
	additionalSigningLinks: null,
};

const firmante = (
	role: string,
	email: string,
	name: string,
	url: string,
): FirmanteDeContrato => ({
	role,
	email,
	name,
	signingUrl: url,
	status: "pending",
});

describe("firmantesEnFicha", () => {
	test("el cofirmante no se muestra como representante legal", () => {
		// Este era el bug: WeeTrust devolvía [titular, cofirmante, rep legal] y la
		// ficha rotulaba el segundo link como "Rep. Legal".
		const filas = firmantesEnFicha(
			[
				firmante("TITULAR", "roselda@x.com", "ROSELDA", "https://w/1"),
				firmante("COFIRMANTE", "edwin@x.com", "EDWIN", "https://w/2"),
				firmante("REP_LEGAL", "juridico@x.com", "LUCRECIA", "https://w/3"),
			],
			SIN_LINKS_VIEJOS,
		);

		expect(filas.map((f) => f.etiqueta)).toEqual([
			"Cliente",
			"Codeudor 1",
			"Rep. Legal",
		]);
		expect(filas.find((f) => f.etiqueta === "Rep. Legal")?.url).toBe(
			"https://w/3",
		);
	});

	test("respeta el orden del documento cuando el rep legal firma primero", () => {
		// En garantía mobiliaria y reconocimiento de deuda el rep legal va antes.
		const filas = firmantesEnFicha(
			[
				firmante("REP_LEGAL", "juridico@x.com", "LUCRECIA", "https://w/1"),
				firmante("TITULAR", "roselda@x.com", "ROSELDA", "https://w/2"),
			],
			SIN_LINKS_VIEJOS,
		);

		expect(filas[0].etiqueta).toBe("Rep. Legal");
		expect(filas[0].url).toBe("https://w/1");
		expect(filas[1].etiqueta).toBe("Cliente");
	});

	test("numera los codeudores", () => {
		const filas = firmantesEnFicha(
			[
				firmante("TITULAR", "a@x.com", "A", "https://w/1"),
				firmante("COFIRMANTE", "b@x.com", "B", "https://w/2"),
				firmante("COFIRMANTE", "c@x.com", "C", "https://w/3"),
			],
			SIN_LINKS_VIEJOS,
		);

		expect(filas.map((f) => f.etiqueta)).toEqual([
			"Cliente",
			"Codeudor 1",
			"Codeudor 2",
		]);
	});

	test("sin firmantes guardados no le pone rol a nadie", () => {
		// Los contratos viejos sólo tienen posiciones, y la posición no dice quién
		// es quién: en garantía mobiliaria el primero es el representante legal.
		// Rotularlo "Cliente" es justo el error que se está arreglando.
		const filas = firmantesEnFicha(undefined, {
			clientSigningLink: "https://w/1",
			representativeSigningLink: "https://w/2",
			additionalSigningLinks: ["https://w/3"],
		});

		expect(filas.map((f) => f.etiqueta)).toEqual([
			"Firmante 1",
			"Firmante 2",
			"Firmante 3",
		]);
		expect(filas.map((f) => f.url)).toEqual([
			"https://w/1",
			"https://w/2",
			"https://w/3",
		]);
	});

	test("un contrato sin links no produce filas", () => {
		expect(firmantesEnFicha([], SIN_LINKS_VIEJOS)).toEqual([]);
	});
});
