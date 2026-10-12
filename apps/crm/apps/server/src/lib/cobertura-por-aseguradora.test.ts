import { describe, expect, test } from "bun:test";
import {
	coberturasQueNoCorresponden,
	normalizarAseguradora,
} from "./cobertura-por-aseguradora";
import { esCartaUnificable } from "./paquete-cartas";

describe("cobertura según la aseguradora", () => {
	test("con G&T no se pueden elegir las dos de Universales", () => {
		expect(coberturasQueNoCorresponden("gyt")).toEqual({
			cobertura_inrexsa: "La cotización es con Seguros G&T",
			cobertura_inrexsa_comercial: "La cotización es con Seguros G&T",
		});
	});

	test("con Universales no se puede elegir la de G&T", () => {
		expect(coberturasQueNoCorresponden("universales")).toEqual({
			cobertura_gyt: "La cotización es con Seguros Universales",
		});
	});

	test("lo que no es G&T es Universales, como en el cierre", () => {
		expect(normalizarAseguradora("gyt")).toBe("gyt");
		expect(normalizarAseguradora(" GYT ")).toBe("gyt");
		expect(normalizarAseguradora("universales")).toBe("universales");
		expect(normalizarAseguradora(null)).toBe("universales");
		expect(normalizarAseguradora(undefined)).toBe("universales");
	});

	test("la de G&T va unida con las demás cartas", () => {
		expect(esCartaUnificable("cobertura_gyt")).toBe(true);
	});
});
