import { describe, expect, test } from "bun:test";
import { esGerente } from "./perfil";

describe("esGerente", () => {
	test("es gerente si lo es en al menos una agencia", () => {
		expect(
			esGerente({
				agencias: [
					{ rol: "usuario" },
					{ rol: "gerente" },
				],
			}),
		).toBe(true);
	});

	test("no es gerente si solo es usuario, no tiene agencias o el perfil no cargó", () => {
		expect(esGerente({ agencias: [{ rol: "usuario" }] })).toBe(false);
		expect(esGerente({ agencias: [] })).toBe(false);
		expect(esGerente(undefined)).toBe(false);
	});
});
