import { describe, expect, test } from "bun:test";
import { armarNombreCliente } from "./nombre-cliente";

describe("armarNombreCliente (H5 · nombre del cliente en las bandejas)", () => {
	test("une las cuatro partes en orden y recorta espacios", () => {
		expect(
			armarNombreCliente({
				firstName: " Carlos ",
				middleName: "Luis",
				lastName: "Morales",
				secondLastName: "Pérez ",
			}),
		).toBe("Carlos Luis Morales Pérez");
	});

	test("salta las partes nulas o solo con espacios", () => {
		expect(
			armarNombreCliente({
				firstName: "Ana",
				middleName: null,
				lastName: "  ",
				secondLastName: "López",
			}),
		).toBe("Ana López");
	});

	test("sin ninguna parte devuelve null, nunca una cadena vacía", () => {
		expect(
			armarNombreCliente({
				firstName: null,
				middleName: "",
				lastName: null,
				secondLastName: "   ",
			}),
		).toBeNull();
	});
});
