import { describe, expect, test } from "bun:test";
import {
	metaCumplidaPct,
	metaDelEquipo,
	montoDe,
	porcentajeEntero,
	rellenarContactabilidad,
	rescatePct,
	resultadoCartera,
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

	test("resultadoCartera junta monto, meta y % (M1)", () => {
		expect(resultadoCartera(80, 50, 100)).toEqual({
			monto: 80,
			montoAnterior: 50,
			meta: 100,
			porcentaje: 80,
		});
		// Pasa de 100 % si supera la meta.
		expect(resultadoCartera(150, null, 100)?.porcentaje).toBe(150);
		// Sin meta (o meta 0) el monto va solo, sin %.
		expect(resultadoCartera(80, 50, null)).toEqual({
			monto: 80,
			montoAnterior: 50,
			meta: null,
			porcentaje: null,
		});
		expect(resultadoCartera(80, 50, 0)?.meta).toBeNull();
		// Recuperación 0 con meta es 0 %, no «—».
		expect(resultadoCartera(0, 0, 100)?.porcentaje).toBe(0);
		// Si no se pudo leer la recuperación, todo es «—».
		expect(resultadoCartera(null, 50, 100)).toBeNull();
	});

	test("rellenarContactabilidad agrega 0 de 0 a quien no tiene gestiones (M7)", () => {
		const filas = [{ userId: "b", efectivos: 3, total: 4 }];
		expect(rellenarContactabilidad(filas, ["a", "b", "a"])).toEqual([
			{ userId: "a", efectivos: 0, total: 0 },
			{ userId: "b", efectivos: 3, total: 4 },
		]);
		// Sin lista pedida devuelve lo que hay.
		expect(rellenarContactabilidad(filas, undefined)).toEqual(filas);
	});
});
