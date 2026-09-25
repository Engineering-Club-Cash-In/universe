import { describe, expect, test } from "bun:test";
import { distanciaMetros } from "./geo";

describe("distanciaMetros", () => {
	test("mismo punto: 0 metros", () => {
		expect(distanciaMetros(14.6349, -90.5069, 14.6349, -90.5069)).toBe(0);
	});

	test("dos puntos conocidos en Ciudad de Guatemala, ~1 km de separación real", () => {
		// Plaza Central (14.6407, -90.5133) a la Torre del Reformador
		// (14.6013, -90.5136), ~4.4 km en línea recta.
		const metros = distanciaMetros(14.6407, -90.5133, 14.6013, -90.5136);
		expect(metros).toBeGreaterThan(4300);
		expect(metros).toBeLessThan(4500);
	});

	test("simétrica: A→B es igual a B→A", () => {
		const ab = distanciaMetros(14.6349, -90.5069, 14.62, -90.51);
		const ba = distanciaMetros(14.62, -90.51, 14.6349, -90.5069);
		expect(ab).toBeCloseTo(ba, 6);
	});
});
