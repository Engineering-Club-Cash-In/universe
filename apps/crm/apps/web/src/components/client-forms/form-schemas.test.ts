import { describe, expect, test } from "bun:test";
import {
	creditApplicationSchema,
	referenciaCrediticiaSchema,
	referenciaPersonalSchema,
} from "./form-schemas";

const DPI_VALIDO = "1234567030101";

describe.each([
	["personal", referenciaPersonalSchema],
	["familiar", referenciaCrediticiaSchema],
])("DPI de la referencia %s", (_tipo, referenciaPersonalSchema) => {
	test("vacío o ausente vale (es opcional)", () => {
		expect(referenciaPersonalSchema.safeParse({}).success).toBe(true);
		expect(referenciaPersonalSchema.safeParse({ dpi: "" }).success).toBe(true);
		expect(referenciaPersonalSchema.safeParse({ dpi: "   " }).success).toBe(
			true,
		);
	});

	test("un DPI válido pasa, con espacios o guiones", () => {
		expect(
			referenciaPersonalSchema.safeParse({ dpi: DPI_VALIDO }).success,
		).toBe(true);
		expect(
			referenciaPersonalSchema.safeParse({ dpi: "1234 56703 0101" }).success,
		).toBe(true);
		expect(
			referenciaPersonalSchema.safeParse({ dpi: "1234-56703-0101" }).success,
		).toBe(true);
	});

	test("mal escrito muestra error: corto, dígito verificador malo, ceros", () => {
		for (const dpi of [
			"12345",
			"1234567040101",
			"0000000000000",
			"abc",
			// con letras o puntos, aunque los dígitos formen un DPI válido
			"1234567030101ab",
			"12a34567030101",
			"1234.56703.0101",
		]) {
			const r = referenciaPersonalSchema.safeParse({ dpi });
			expect(r.success).toBe(false);
		}
	});
});

describe("tope de referencias por lista en la solicitud", () => {
	const solicitud = (personales: number, familiares: number) => ({
		primerApellido: "López",
		primerNombre: "Ana",
		dpi: DPI_VALIDO,
		cuentasBancarias: [],
		referenciasPersonales: Array.from({ length: personales }, () => ({})),
		referenciasCrediticias: Array.from({ length: familiares }, () => ({})),
	});

	test("las 3 de cada lista que manda el formulario, y hasta 10, pasan", () => {
		expect(creditApplicationSchema.safeParse(solicitud(3, 3)).success).toBe(
			true,
		);
		expect(creditApplicationSchema.safeParse(solicitud(10, 10)).success).toBe(
			true,
		);
	});

	test("más de 10 en cualquiera de las dos listas no pasa", () => {
		expect(creditApplicationSchema.safeParse(solicitud(11, 3)).success).toBe(
			false,
		);
		expect(creditApplicationSchema.safeParse(solicitud(3, 11)).success).toBe(
			false,
		);
	});
});
