import { describe, expect, test } from "bun:test";
import { nombreCliente } from "./tracker";

describe("nombreCliente", () => {
	test("los 4 campos presentes", () => {
		expect(nombreCliente("Pedro", "Antonio", "Vásquez", "López")).toBe(
			"Pedro Antonio Vásquez López",
		);
	});

	test("solo primer nombre y primer apellido (los únicos obligatorios)", () => {
		expect(nombreCliente("Jackson", null, "Barrios", null)).toBe(
			"Jackson Barrios",
		);
	});

	test("solo nombre", () => {
		expect(nombreCliente("Jackson", null, null, null)).toBe("Jackson");
	});

	test("solo apellido", () => {
		expect(nombreCliente(null, null, "Ramírez", null)).toBe("Ramírez");
	});

	test("ninguno", () => {
		expect(nombreCliente(null, null, null, null)).toBe("Cliente sin nombre");
	});

	test("recorta espacios en blanco de sobra", () => {
		expect(nombreCliente("  Pedro  ", " ", "  Vásquez  ", "")).toBe(
			"Pedro Vásquez",
		);
	});
});
