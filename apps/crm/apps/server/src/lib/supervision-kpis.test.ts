import { describe, expect, test } from "bun:test";
import {
	metaCumplidaPct,
	metaDelEquipo,
	montoDe,
	porcentajeEntero,
	rescatePct,
} from "./supervision-kpis";

describe("supervision-kpis", () => {
	test("porcentajeEntero redondea y no divide por cero", () => {
		expect(porcentajeEntero(1, 3)).toBe(33);
		expect(porcentajeEntero(2, 3)).toBe(67);
		expect(porcentajeEntero(5, 0)).toBeNull();
		expect(porcentajeEntero(5, null)).toBeNull();
	});

	test("metaDelEquipo suma solo asesores con meta", () => {
		expect(metaDelEquipo([100, null, 50.5])).toBe(150.5);
		expect(metaDelEquipo([null, 0])).toBeNull();
		expect(metaDelEquipo([])).toBeNull();
	});

	test("metaCumplidaPct usa la meta prorrateada", () => {
		expect(metaCumplidaPct(88, 100)).toBe(88);
		expect(metaCumplidaPct(150, 100)).toBe(150);
		expect(metaCumplidaPct(10, null)).toBeNull();
		expect(metaCumplidaPct(null, 100)).toBeNull();
	});

	test("rescatePct = recuperados / (recuperados + escalados)", () => {
		expect(rescatePct(3, 1)).toBe(75);
		expect(rescatePct(1, 1)).toBe(50);
		expect(rescatePct(2, 0)).toBe(100);
		expect(rescatePct(0, 4)).toBe(0);
	});

	test("rescatePct sin movimientos es null, no 0", () => {
		expect(rescatePct(0, 0)).toBeNull();
	});

	test("montoDe tolera basura", () => {
		expect(montoDe("12.50")).toBe(12.5);
		expect(montoDe(undefined)).toBe(0);
		expect(montoDe("abc")).toBe(0);
	});
});
