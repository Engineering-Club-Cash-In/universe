import { describe, expect, test } from "bun:test";
import {
	type CambioEstadoPromesa,
	decidirTransiciones,
	deduplicarCambios,
	type FilaBloqueada,
} from "./promesa-estado-batch";

function fila(overrides: Partial<FilaBloqueada> = {}): FilaBloqueada {
	return {
		id: "p-1",
		estadoPromesa: "pendiente",
		casoCobroId: "caso-1",
		...overrides,
	};
}

describe("deduplicarCambios", () => {
	test("conserva el último estado de un id repetido", () => {
		// Dos entradas del mismo id se colapsan en una: si se aplicaran las dos,
		// la segunda auditaría un "de" que ya no era el vigente.
		const cambios: CambioEstadoPromesa[] = [
			{ id: "p-1", estado: "cumplida" },
			{ id: "p-1", estado: "incumplida" },
		];

		const mapa = deduplicarCambios(cambios);

		expect(mapa.size).toBe(1);
		expect(mapa.get("p-1")).toBe("incumplida");
	});

	test("mantiene ids distintos", () => {
		const mapa = deduplicarCambios([
			{ id: "p-1", estado: "cumplida" },
			{ id: "p-2", estado: "pendiente" },
		]);

		expect(mapa.size).toBe(2);
	});
});

describe("decidirTransiciones", () => {
	test("omite las filas que ya están en el estado calculado", () => {
		// El guard de no-op: sin esto, cada apertura de Ficha 360 y cada corrida
		// del job escribirían igual, y la bitácora se llenaría de filas
		// 'pendiente → pendiente' sin información.
		const filas = [fila({ id: "p-1", estadoPromesa: "pendiente" })];
		const mapa = deduplicarCambios([{ id: "p-1", estado: "pendiente" }]);

		expect(decidirTransiciones(filas, mapa)).toEqual([]);
	});

	test("registra el cambio con el 'de' de la fila bloqueada", () => {
		const filas = [
			fila({ id: "p-1", estadoPromesa: "pendiente", casoCobroId: "caso-9" }),
		];
		const mapa = deduplicarCambios([{ id: "p-1", estado: "cumplida" }]);

		expect(decidirTransiciones(filas, mapa)).toEqual([
			{ id: "p-1", casoCobroId: "caso-9", de: "pendiente", a: "cumplida" },
		]);
	});

	test("una promesa nunca evaluada (estado NULL) sí genera transición", () => {
		// El caso que un guard `ne(estado, nuevo)` en el WHERE se comía: en SQL,
		// NULL <> 'pendiente' no es true, así que la primera evaluación nunca se
		// escribía. Con la comparación en JS sí entra.
		const filas = [fila({ estadoPromesa: null })];
		const mapa = deduplicarCambios([{ id: "p-1", estado: "pendiente" }]);

		const resultado = decidirTransiciones(filas, mapa);

		expect(resultado).toHaveLength(1);
		expect(resultado[0].de).toBeNull();
		expect(resultado[0].a).toBe("pendiente");
	});

	test("ignora filas bloqueadas que no venían en el lote", () => {
		const filas = [fila({ id: "ajena", estadoPromesa: "pendiente" })];
		const mapa = deduplicarCambios([{ id: "p-1", estado: "cumplida" }]);

		expect(decidirTransiciones(filas, mapa)).toEqual([]);
	});

	test("procesa un lote mixto: solo salen los que cambian", () => {
		const filas = [
			fila({ id: "p-1", estadoPromesa: "pendiente" }),
			fila({ id: "p-2", estadoPromesa: "cumplida" }), // sin cambio
			fila({ id: "p-3", estadoPromesa: null }),
		];
		const mapa = deduplicarCambios([
			{ id: "p-1", estado: "incumplida" },
			{ id: "p-2", estado: "cumplida" },
			{ id: "p-3", estado: "pendiente" },
		]);

		expect(decidirTransiciones(filas, mapa).map((t) => t.id)).toEqual([
			"p-1",
			"p-3",
		]);
	});

	test("preserva el orden en que vinieron las filas bloqueadas", () => {
		// Las filas llegan ordenadas por id desde el SELECT ... FOR UPDATE (el
		// orden que evita el deadlock contra el job); la decisión no debe
		// reordenarlas.
		const filas = [
			fila({ id: "a", estadoPromesa: "pendiente" }),
			fila({ id: "b", estadoPromesa: "pendiente" }),
			fila({ id: "c", estadoPromesa: "pendiente" }),
		];
		const mapa = deduplicarCambios([
			{ id: "c", estado: "cumplida" },
			{ id: "a", estado: "cumplida" },
			{ id: "b", estado: "cumplida" },
		]);

		expect(decidirTransiciones(filas, mapa).map((t) => t.id)).toEqual([
			"a",
			"b",
			"c",
		]);
	});
});
