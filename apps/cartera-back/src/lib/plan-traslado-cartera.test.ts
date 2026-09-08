import { describe, expect, test } from "bun:test";
import { previsualizarTrasladoCartera } from "./plan-traslado-cartera";

describe("previsualizarTrasladoCartera", () => {
	test("reparte compromisos vigentes primero y balancea por bucket", () => {
		const resultado = previsualizarTrasladoCartera({
			asesorOrigenId: 10,
			modo: "redistribucion",
			creditos: [
				{ creditoId: 4, bucket: 1, asesorId: 10, tieneCompromisoVigente: false },
				{ creditoId: 3, bucket: 1, asesorId: 10, tieneCompromisoVigente: true },
				{ creditoId: 2, bucket: 1, asesorId: 10, tieneCompromisoVigente: false },
			],
			poolPorBucket: new Map([[1, [20, 30]]]),
			cargaPorBucket: new Map([[1, new Map([[20, 4], [30, 3]])]]),
		});

		expect(resultado.bloqueos).toEqual([]);
		expect(resultado.asignaciones).toEqual([
			{ creditoId: 3, asesorAnteriorId: 10, asesorNuevoId: 30, bucket: 1, prioridad: 0 },
			{ creditoId: 2, asesorAnteriorId: 10, asesorNuevoId: 20, bucket: 1, prioridad: 1 },
			{ creditoId: 4, asesorAnteriorId: 10, asesorNuevoId: 30, bucket: 1, prioridad: 1 },
		]);
	});

	test("bloquea crédito operativo sin receptor elegible y excluye crédito fuera del funnel", () => {
		const resultado = previsualizarTrasladoCartera({
			asesorOrigenId: 10,
			modo: "redistribucion",
			creditos: [
				{ creditoId: 1, bucket: null, asesorId: 10, tieneCompromisoVigente: false },
				{ creditoId: 2, bucket: 2, asesorId: 10, tieneCompromisoVigente: false },
			],
			poolPorBucket: new Map([[2, [10]]]),
			cargaPorBucket: new Map(),
		});

		expect(resultado.asignaciones).toEqual([]);
		expect(resultado.excluidos).toEqual([{ creditoId: 1, razon: "fuera_del_funnel" }]);
		expect(resultado.bloqueos).toEqual([{ bucket: 2, creditoId: 2, razon: "sin_receptor_elegible" }]);
	});

	test("destino único rechaza bucket que no cubre", () => {
		const resultado = previsualizarTrasladoCartera({
			asesorOrigenId: 10,
			asesorDestinoId: 20,
			modo: "traslado_completo",
			creditos: [{ creditoId: 1, bucket: 3, asesorId: 10, tieneCompromisoVigente: false }],
			poolPorBucket: new Map([[3, [30]]]),
			cargaPorBucket: new Map(),
		});

		expect(resultado.asignaciones).toEqual([]);
		expect(resultado.bloqueos).toEqual([{ bucket: 3, creditoId: 1, razon: "destino_no_elegible" }]);
	});

	test("usa destino elegido distinto para cada bucket", () => {
		const resultado = previsualizarTrasladoCartera({
			asesorOrigenId: 10,
			modo: "destino_por_bucket",
			destinosPorBucket: new Map([
				[1, 20],
				[2, 30],
			]),
			creditos: [
				{ creditoId: 1, bucket: 1, asesorId: 10, tieneCompromisoVigente: false },
				{ creditoId: 2, bucket: 2, asesorId: 10, tieneCompromisoVigente: true },
			],
			poolPorBucket: new Map([
				[1, [20, 21]],
				[2, [30, 31]],
			]),
			cargaPorBucket: new Map([
				[1, new Map([[20, 10], [21, 0]])],
				[2, new Map([[30, 10], [31, 0]])],
			]),
		});

		expect(resultado.bloqueos).toEqual([]);
		expect(resultado.asignaciones).toEqual([
			{ creditoId: 2, asesorAnteriorId: 10, asesorNuevoId: 30, bucket: 2, prioridad: 0 },
			{ creditoId: 1, asesorAnteriorId: 10, asesorNuevoId: 20, bucket: 1, prioridad: 1 },
		]);
	});

	test("mueve cuentas especiales sin bucket a destino explícito", () => {
		const resultado = previsualizarTrasladoCartera({
			asesorOrigenId: 10,
			asesorDestinoEspecialId: 20,
			modo: "destino_por_bucket",
			destinosPorBucket: new Map([[1, 30]]),
			creditos: [
				{
					creditoId: 1,
					bucket: null,
					asesorId: 10,
					tieneCompromisoVigente: false,
					esEspecial: true,
				},
				{ creditoId: 2, bucket: 1, asesorId: 10, tieneCompromisoVigente: false },
			],
			poolPorBucket: new Map([[1, [30]]]),
			cargaPorBucket: new Map(),
		});

		expect(resultado.excluidos).toEqual([]);
		expect(resultado.asignaciones).toEqual([
			{ creditoId: 1, asesorAnteriorId: 10, asesorNuevoId: 20, bucket: null, prioridad: 1 },
			{ creditoId: 2, asesorAnteriorId: 10, asesorNuevoId: 30, bucket: 1, prioridad: 1 },
		]);
	});
});
