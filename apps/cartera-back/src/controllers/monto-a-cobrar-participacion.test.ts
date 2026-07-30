import { describe, expect, test } from "bun:test";
import {
	agregarParticipacionExterna,
	splitMontoSegunParticipacionActual,
} from "./monto-a-cobrar-participacion";

describe("splitMontoSegunParticipacionActual", () => {
	test("asigna 0% externo completamente a CUBE", () => {
		expect(splitMontoSegunParticipacionActual(100, 12, 0)).toEqual({
			valido: true,
			capitalInv: 0,
			capitalCube: 100,
			interesIvaInv: 0,
			interesIvaCube: 12,
		});
	});

	test("asigna 100% externo completamente a Inv.", () => {
		expect(splitMontoSegunParticipacionActual(100, 12, 1)).toEqual({
			valido: true,
			capitalInv: 100,
			capitalCube: 0,
			interesIvaInv: 12,
			interesIvaCube: 0,
		});
	});

	test("redondea Inv. por crédito y conserva CUBE por diferencia", () => {
		const split = splitMontoSegunParticipacionActual(100.01, 10.01, 0.3333);

		expect(split).toEqual({
			valido: true,
			capitalInv: 33.33,
			capitalCube: 66.68,
			interesIvaInv: 3.34,
			interesIvaCube: 6.67,
		});
		if (split.valido) {
			expect(split.capitalInv + split.capitalCube).toBe(100.01);
			expect(split.interesIvaInv + split.interesIvaCube).toBe(10.01);
		}
	});

	test("calcula CUBE como diferencia exacta sin redondearlo de nuevo", () => {
		const split = splitMontoSegunParticipacionActual(100.019, 10.019, 0.5);

		expect(split).toMatchObject({ valido: true, capitalInv: 50.01, interesIvaInv: 5.01 });
		if (split.valido) {
			expect(split.capitalCube).toBeCloseTo(50.009, 10);
			expect(split.interesIvaCube).toBeCloseTo(5.009, 10);
		}
	});

	test("excluye del split una participación agregada inválida", () => {
		expect(splitMontoSegunParticipacionActual(100, 12, 1.01)).toEqual({
			valido: false,
			capitalInv: 0,
			capitalCube: 0,
			interesIvaInv: 0,
			interesIvaCube: 0,
		});
	});
});

test("agrega múltiples participaciones externas sin duplicar la base", () => {
	expect(agregarParticipacionExterna([25, 25, 50])).toBe(1);
	const split = splitMontoSegunParticipacionActual(
		200,
		20,
		agregarParticipacionExterna([25, 25]),
	);
	expect(split).toMatchObject({ capitalInv: 100, capitalCube: 100 });
});
