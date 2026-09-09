import { expect, test } from "bun:test";
import {
	puedeRecibirTodosBuckets,
	resumirTraslado,
	validarFormularioTraslado,
} from "./traslados";

test("requiere destino distinto para traslado directo y conserva redistribución automática", () => {
	expect(
		validarFormularioTraslado({
			modo: "traslado_completo",
			origen: "1",
			destino: "1",
			motivo: "Renuncia",
		}),
	).toBeTruthy();
	expect(
		validarFormularioTraslado({
			modo: "traslado_completo",
			origen: "1",
			destino: "",
			motivo: "Renuncia",
		}),
	).toBeTruthy();
	expect(
		validarFormularioTraslado({
			modo: "redistribucion",
			origen: "1",
			destino: "",
			motivo: "Renuncia",
		}),
	).toBeNull();
});

test("requiere un destino para cada bucket en asignación manual", () => {
	expect(
		validarFormularioTraslado({
			modo: "destino_por_bucket",
			origen: "1",
			destino: "",
			destinosPorBucket: { 1: "2" },
			bucketsOrigen: [1, 2],
			motivo: "Renuncia",
		}),
	).toBeTruthy();
	expect(
		validarFormularioTraslado({
			modo: "destino_por_bucket",
			origen: "1",
			destino: "",
			destinosPorBucket: { 1: "2", 2: "3" },
			bucketsOrigen: [1, 2],
			motivo: "Renuncia",
		}),
	).toBeNull();
});

test("rechaza el origen como destino de un bucket", () => {
	expect(
		validarFormularioTraslado({
			modo: "destino_por_bucket",
			origen: "1",
			destino: "",
			destinosPorBucket: { 1: "2", 2: "1" },
			bucketsOrigen: [1, 2],
			motivo: "Renuncia",
		}),
	).toBeTruthy();
	// Un destino inválido en un bucket que ya NO está en bucketsOrigen (la
	// cartera cambió entre que se eligió y se envió): la comprobación recorre
	// destinosPorBucket entero, no solo los buckets vigentes, así que igual lo
	// detecta en vez de mandar al backend un destino = origen.
	expect(
		validarFormularioTraslado({
			modo: "destino_por_bucket",
			origen: "1",
			destino: "",
			destinosPorBucket: { 1: "2", 5: "1" },
			bucketsOrigen: [1],
			motivo: "Renuncia",
		}),
	).toBeTruthy();
});

test("destino único debe cubrir todos los buckets del origen", () => {
	expect(puedeRecibirTodosBuckets([1, 2], [1, 2, 3])).toBe(true);
	expect(puedeRecibirTodosBuckets([1, 2], [1])).toBe(false);
});

test("agrupa cuentas y compromisos por receptor y bucket sin mezclar buckets", () => {
	expect(
		resumirTraslado([
			{ bucket: 1, asesorNuevoId: 2, prioridad: 0 },
			{ bucket: 1, asesorNuevoId: 2, prioridad: 1 },
			{ bucket: 2, asesorNuevoId: 2, prioridad: 0 },
		]),
	).toEqual([
		{ bucket: 1, asesorId: 2, cuentas: 2, compromisos: 1 },
		{ bucket: 2, asesorId: 2, cuentas: 1, compromisos: 1 },
	]);
});
