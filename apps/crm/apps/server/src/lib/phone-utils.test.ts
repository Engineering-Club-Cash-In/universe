import { describe, expect, test } from "bun:test";
import { primerTelefono } from "./phone-utils";

describe("primerTelefono", () => {
	test("toma el primero de varios números", () => {
		expect(primerTelefono("30295849 / 34831060, 66372557")).toBe("30295849");
	});

	test("salta los pedazos sin número válido", () => {
		expect(primerTelefono("Sin teléfono / 30295849")).toBe("30295849");
		expect(primerTelefono("123 / 3029-5849")).toBe("3029-5849");
	});

	test("sin ningún número válido devuelve null", () => {
		expect(primerTelefono("Sin teléfono")).toBeNull();
		expect(primerTelefono("")).toBeNull();
		expect(primerTelefono(null)).toBeNull();
	});
});
