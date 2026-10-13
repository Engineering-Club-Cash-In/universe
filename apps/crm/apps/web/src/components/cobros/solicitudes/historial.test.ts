import { describe, expect, test } from "bun:test";
import { fechaDeCorte, recortarAlCorte } from "./historial";

const f = (fecha: string | null) => ({ fecha });

describe("fechaDeCorte", () => {
	test("sin fuentes incompletas no hay corte", () => {
		expect(fechaDeCorte([])).toBeNull();
	});

	test("una fuente incompleta sin filas cargadas no corta", () => {
		expect(fechaDeCorte([[]])).toBeNull();
		expect(fechaDeCorte([[f(null)]])).toBeNull();
	});

	test("es la más reciente de las fechas más viejas de cada fuente", () => {
		const corte = fechaDeCorte([
			// Trajo solo su última semana.
			[f("2026-10-12T10:00:00Z"), f("2026-10-06T10:00:00Z")],
			// Trajo meses.
			[f("2026-10-10T10:00:00Z"), f("2026-07-01T10:00:00Z")],
		]);
		expect(corte).toBe(new Date("2026-10-06T10:00:00Z").getTime());
	});

	test("ignora fechas inválidas", () => {
		expect(fechaDeCorte([[f("no es fecha"), f("2026-10-01T00:00:00Z")]])).toBe(
			new Date("2026-10-01T00:00:00Z").getTime(),
		);
	});
});

describe("recortarAlCorte", () => {
	const filas = [
		f("2026-10-12T10:00:00Z"),
		f("2026-10-06T10:00:00Z"),
		f("2026-09-01T10:00:00Z"),
		f(null),
	];

	test("sin corte deja todo", () => {
		expect(recortarAlCorte(filas, null)).toEqual(filas);
	});

	test("deja lo del corte en adelante (inclusive) y quita lo sin fecha", () => {
		const corte = new Date("2026-10-06T10:00:00Z").getTime();
		expect(recortarAlCorte(filas, corte)).toEqual([filas[0], filas[1]]);
	});

	test("conservar deja pasar filas viejas que se muestran siempre", () => {
		const corte = new Date("2026-10-06T10:00:00Z").getTime();
		expect(
			recortarAlCorte(
				filas,
				corte,
				(x) => x.fecha?.startsWith("2026-09") ?? false,
			),
		).toEqual([filas[0], filas[1], filas[2]]);
	});
});
