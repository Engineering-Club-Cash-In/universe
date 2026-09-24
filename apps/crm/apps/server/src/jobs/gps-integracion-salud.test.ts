import { describe, expect, test } from "bun:test";
import { esIntentoExitoso } from "../services/wialon/wialon-clasificacion";
import { _INTERNOS } from "./gps-integracion-salud";

const { percentil95 } = _INTERNOS;

/**
 * CB-121 — solo la función pura (sin tocar `db`): el resto del job
 * (abrir/reforzar/resolver alertas, purga) se verifica manualmente en dev
 * apuntando WIALON_BASE_URL a un host inválido, según el plan de la tarea.
 */
describe("percentil95", () => {
	test("null con arreglo vacío", () => {
		expect(percentil95([])).toBeNull();
	});

	test("un solo valor es su propio p95", () => {
		expect(percentil95([100])).toBe(100);
	});

	test("calcula el p95 sobre valores desordenados", () => {
		const valores = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
		// El percentil 95 de 1..100 (redondeando hacia arriba) es 95.
		expect(percentil95(valores)).toBe(95);
	});

	test("no se ve afectado por el orden de entrada", () => {
		const ordenado = [10, 20, 30, 40, 50];
		const desordenado = [50, 10, 40, 20, 30];
		expect(percentil95(desordenado)).toBe(percentil95(ordenado));
	});
});

describe("esIntentoExitoso", () => {
	test("ok es exitoso", () => {
		expect(esIntentoExitoso({ resultado: "ok", errorCode: null })).toBe(true);
	});

	test("reintentado sin código de error es éxito tras reintento", () => {
		expect(
			esIntentoExitoso({ resultado: "reintentado", errorCode: null }),
		).toBe(true);
	});

	test("reintentado con código de error es un fallo con reintentos pendientes", () => {
		expect(
			esIntentoExitoso({
				resultado: "reintentado",
				errorCode: "WIALON_TIMEOUT",
			}),
		).toBe(false);
	});

	test("error e incierto no son exitosos", () => {
		expect(
			esIntentoExitoso({ resultado: "error", errorCode: "WIALON_TIMEOUT" }),
		).toBe(false);
		expect(
			esIntentoExitoso({
				resultado: "incierto",
				errorCode: "WIALON_RESULTADO_INCIERTO",
			}),
		).toBe(false);
	});
});
