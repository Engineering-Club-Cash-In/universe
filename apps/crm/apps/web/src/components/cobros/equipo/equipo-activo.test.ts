import { describe, expect, test } from "bun:test";
import { filtrarEquipoActivo } from "./estado-asesor";

const asesor = (asesor_id: number, buckets: number[], activo = true) => ({
	asesor_id,
	activo,
	buckets,
});

describe("filtrarEquipoActivo", () => {
	test("deja a los activos con buckets y quita a los inactivos", () => {
		const r = filtrarEquipoActivo(
			[asesor(1, [0, 1]), asesor(2, [2], false)],
			new Set(),
		);
		expect(r.map((a) => a.asesor_id)).toEqual([1]);
	});

	test("un asesor sin buckets sale del equipo", () => {
		expect(filtrarEquipoActivo([asesor(3, [])], new Set())).toEqual([]);
	});

	test("con ausencia indefinida se queda aunque cartera le haya apagado el pool", () => {
		const r = filtrarEquipoActivo([asesor(4, [])], new Set([4]));
		expect(r.map((a) => a.asesor_id)).toEqual([4]);
	});

	test("un inactivo no vuelve por tener una ausencia", () => {
		expect(filtrarEquipoActivo([asesor(5, [], false)], new Set([5]))).toEqual(
			[],
		);
	});
});
