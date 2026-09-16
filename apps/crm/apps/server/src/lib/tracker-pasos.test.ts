import { describe, expect, test } from "bun:test";
import {
	etiquetaDePaso,
	PASOS_TRACKER,
	pasoDesdeCierre,
} from "./tracker-pasos";

describe("pasoDesdeCierre", () => {
	test("colapsa las 10 etapas reales de sales_stages en los 5 pasos del socio", () => {
		// Los porcentajes salen de salesStagesData en db/seed.ts.
		expect([1, 10, 20].map(pasoDesdeCierre)).toEqual([1, 1, 1]);
		expect([30, 40].map(pasoDesdeCierre)).toEqual([2, 2]);
		expect([50, 80].map(pasoDesdeCierre)).toEqual([3, 3]);
		expect([85, 90].map(pasoDesdeCierre)).toEqual([4, 4]);
		expect(pasoDesdeCierre(100)).toBe(5);
	});

	test("cada porcentaje cae dentro del rango declarado de su paso", () => {
		for (const pct of [1, 10, 20, 30, 40, 50, 80, 85, 90, 100]) {
			const paso = pasoDesdeCierre(pct);
			const rango = PASOS_TRACKER[paso - 1];
			expect(pct).toBeGreaterThanOrEqual(rango.desde);
			expect(pct).toBeLessThanOrEqual(rango.hasta);
		}
	});

	test("es monótona: más avance nunca devuelve un paso menor", () => {
		let anterior = 0;
		for (let pct = 0; pct <= 100; pct++) {
			const paso = pasoDesdeCierre(pct);
			expect(paso).toBeGreaterThanOrEqual(anterior);
			anterior = paso;
		}
	});

	test("tolera porcentajes fuera de las etapas conocidas", () => {
		expect(pasoDesdeCierre(0)).toBe(1);
		expect(pasoDesdeCierre(29)).toBe(1);
		expect(pasoDesdeCierre(49)).toBe(2);
		expect(pasoDesdeCierre(99)).toBe(4);
		expect(pasoDesdeCierre(120)).toBe(5);
	});
});

describe("etiquetaDePaso", () => {
	test("devuelve la etiqueta que ve el socio", () => {
		expect(etiquetaDePaso(1)).toBe("Solicitud recibida");
		expect(etiquetaDePaso(3)).toBe("Aprobado");
		expect(etiquetaDePaso(5)).toBe("Desembolsado");
	});
});
