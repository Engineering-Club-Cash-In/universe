import { describe, expect, test } from "bun:test";
import { parseOtrosGTQ } from "./pagalo-otros";

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
