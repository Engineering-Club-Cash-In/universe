import { describe, expect, test } from "bun:test";
import {
	type FilaAsesorEquipo,
	filtrarPorGrupo,
	resumenEquipo,
} from "./asesores-vista";

const fila = (
	asesorId: number,
	nivel: FilaAsesorEquipo["nivel"],
	estado: FilaAsesorEquipo["estado"] = "al_dia",
) => ({ asesorId, nivel, estado }) as FilaAsesorEquipo;

describe("filtrarPorGrupo con un ausente sin pool", () => {
	const filas = [
		fila(1, "junior"),
		fila(2, "senior"),
		// Ausencia indefinida: cartera le apagó el pool y su nivel no se calcula.
		fila(3, null, "ausente"),
		// Ausente con suplente: conserva su nivel y no sale en otras vistas.
		fila(4, "senior", "ausente"),
	];

	test("aparece en todas las vistas de nivel para poder reactivarlo", () => {
		for (const g of ["junior", "senior", "especial"] as const)
			expect(filtrarPorGrupo(filas, g).map((f) => f.asesorId)).toContain(3);
	});

	test("un ausente con nivel solo sale en el suyo", () => {
		expect(filtrarPorGrupo(filas, "junior").map((f) => f.asesorId)).toEqual([
			1, 3,
		]);
		expect(filtrarPorGrupo(filas, "senior").map((f) => f.asesorId)).toEqual([
			2, 3, 4,
		]);
	});
});

describe("resumenEquipo", () => {
	test("cuenta aparte a los que no tienen pool", () => {
		expect(resumenEquipo(["junior", "senior", null])).toBe(
			"3 asesores · 1 Junior · 1 Senior · 1 sin pool",
		);
	});
});
