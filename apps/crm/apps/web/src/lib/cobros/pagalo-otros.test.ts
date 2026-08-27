import { describe, expect, test } from "bun:test";
import { facturableSinOtrosGTQ, parseOtrosGTQ } from "./pagalo-otros";

describe("parseOtrosGTQ", () => {
	test("acepta monto positivo con hasta dos decimales", () => {
		expect(parseOtrosGTQ("12.34")).toEqual({ valid: true, value: "12.34" });
		expect(parseOtrosGTQ("5")).toEqual({ valid: true, value: "5.00" });
	});

	test("rechaza cero, negativos, vacío y más de dos decimales", () => {
		for (const value of ["", "0", "0.00", "-1", "1.234", "abc"])
			expect(parseOtrosGTQ(value)).toEqual({ valid: false });
	});
});

describe("facturableSinOtrosGTQ", () => {
	test("separa Otros del total facturable sin perder centavos", () => {
		expect(facturableSinOtrosGTQ("3813.26", "50.00")).toBe("3763.26");
	});

	test("nunca muestra un monto negativo", () => {
		expect(facturableSinOtrosGTQ("0.00", "50.00")).toBe("0.00");
	});
});
