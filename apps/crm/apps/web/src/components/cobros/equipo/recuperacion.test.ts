import { describe, expect, test } from "bun:test";
import {
	resultadoRecuperacion,
	tonoRecuperacion,
	variacionRecuperacion,
} from "./recuperacion";

describe("recuperacion", () => {
	test("el detalle muestra monto y meta, o solo el monto sin meta", () => {
		expect(
			resultadoRecuperacion({
				monto: 8400,
				montoAnterior: null,
				meta: 9100,
				porcentaje: 92,
			}),
		).toEqual({ porcentaje: 92, detalle: "Q8.4K de Q9.1K", tono: "normal" });
		expect(
			resultadoRecuperacion({
				monto: 669.37,
				montoAnterior: 100,
				meta: null,
				porcentaje: null,
			})?.detalle,
		).toBe("Q669 · sin meta");
	});

	test("sin dato del servidor no hay resultado", () => {
		expect(resultadoRecuperacion(null)).toBeNull();
		expect(resultadoRecuperacion(undefined)).toBeNull();
	});

	test("el tono sigue el avance de la meta", () => {
		expect(tonoRecuperacion(null)).toBe("normal");
		expect(tonoRecuperacion(120)).toBe("success");
		expect(tonoRecuperacion(70)).toBe("normal");
		expect(tonoRecuperacion(40)).toBe("warning");
		expect(tonoRecuperacion(5)).toBe("danger");
	});

	test("la variación necesita un período anterior con base", () => {
		const r = { monto: 150, montoAnterior: 100, meta: null, porcentaje: null };
		expect(variacionRecuperacion(r)).toBe(50);
		expect(variacionRecuperacion({ ...r, montoAnterior: 0 })).toBeNull();
		expect(variacionRecuperacion({ ...r, montoAnterior: null })).toBeNull();
		expect(variacionRecuperacion(null)).toBeNull();
	});
});
