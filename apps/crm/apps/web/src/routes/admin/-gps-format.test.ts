import { describe, expect, test } from "bun:test";
import { formatFechaHora, formatLatency, resolveEstado } from "./-gps-format";

describe("formatLatency", () => {
	test("formatea milisegundos", () => {
		expect(formatLatency(142)).toBe("142 ms");
		expect(formatLatency(0)).toBe("0 ms");
	});

	test("retorna guión largo ante null o valores no finitos", () => {
		expect(formatLatency(null)).toBe("—");
		expect(formatLatency(Number.NaN)).toBe("—");
	});
});

describe("formatFechaHora", () => {
	test("retorna guión largo cuando no hay fecha", () => {
		expect(formatFechaHora(null)).toBe("—");
	});

	test("formatea una fecha válida en es-GT", () => {
		const result = formatFechaHora(new Date("2026-09-22T18:30:00Z"));
		expect(result).not.toBe("—");
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("retorna guión largo ante una fecha inválida sin lanzar", () => {
		expect(formatFechaHora(new Date(Number.NaN))).toBe("—");
	});
});

describe("resolveEstado", () => {
	test("caido cuando no hay conexión, sin importar latencia o conteo", () => {
		expect(
			resolveEstado({ connected: false, latencyMs: null, unitCount: null }),
		).toBe("caido");
	});

	test("degradado cuando conecta pero la latencia supera 5000ms", () => {
		expect(
			resolveEstado({ connected: true, latencyMs: 5001, unitCount: 70 }),
		).toBe("degradado");
	});

	test("degradado cuando conecta pero la flota está vacía", () => {
		expect(
			resolveEstado({ connected: true, latencyMs: 100, unitCount: 0 }),
		).toBe("degradado");
	});

	test("conectado cuando responde rápido y con flota", () => {
		expect(
			resolveEstado({ connected: true, latencyMs: 150, unitCount: 70 }),
		).toBe("conectado");
	});

	test("conectado en el límite exacto de 5000ms (no estrictamente mayor)", () => {
		expect(
			resolveEstado({ connected: true, latencyMs: 5000, unitCount: 70 }),
		).toBe("conectado");
	});
});
