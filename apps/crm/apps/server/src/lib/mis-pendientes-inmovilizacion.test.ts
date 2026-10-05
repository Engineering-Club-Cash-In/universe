import { describe, expect, it } from "bun:test";
import {
	armarPendientes,
	type FilaPendiente,
} from "./mis-pendientes-inmovilizacion";

const fila = (parcial: Partial<FilaPendiente> = {}): FilaPendiente => ({
	inmovilizacionId: "i-1",
	casoId: "c-1",
	numeroCreditoSifco: "01010214100000",
	accion: "apagado",
	estado: "aprobada",
	decididoAt: new Date("2026-10-01T10:00:00Z"),
	ejecutadoAt: null,
	...parcial,
});

describe("armarPendientes", () => {
	it("sin filas: sin pendientes", () => {
		expect(armarPendientes([], [])).toEqual([]);
	});

	it("aprobada es por ejecutar y cuenta desde la decisión", () => {
		const [p] = armarPendientes([fila()], []);
		expect(p).toMatchObject({
			tipo: "por_ejecutar",
			desde: new Date("2026-10-01T10:00:00Z"),
		});
	});

	it("rechazada se marca como tal", () => {
		const [p] = armarPendientes([fila({ estado: "rechazada" })], []);
		expect(p.tipo).toBe("rechazada");
	});

	it("la llamada pendiente cuenta desde la ejecución", () => {
		const ejecutadoAt = new Date("2026-10-02T09:00:00Z");
		const [p] = armarPendientes(
			[],
			[fila({ estado: "ejecutada", decididoAt: null, ejecutadoAt })],
		);
		expect(p).toMatchObject({ tipo: "llamar_cliente", desde: ejecutadoAt });
	});

	it("dos avisos de la misma solicitud no duplican la fila", () => {
		expect(armarPendientes([fila(), fila()], [])).toHaveLength(1);
	});

	it("la misma solicitud puede ser por ejecutar y, otra, llamada: no se mezclan", () => {
		const r = armarPendientes(
			[fila({ inmovilizacionId: "i-1" })],
			[fila({ inmovilizacionId: "i-2", estado: "ejecutada" })],
		);
		expect(r.map((p) => p.tipo)).toEqual(["por_ejecutar", "llamar_cliente"]);
	});

	it("conserva el orden: decididas y luego llamadas", () => {
		const r = armarPendientes(
			[fila({ inmovilizacionId: "a" }), fila({ inmovilizacionId: "b" })],
			[fila({ inmovilizacionId: "c", estado: "ejecutada" })],
		);
		expect(r.map((p) => p.inmovilizacionId)).toEqual(["a", "b", "c"]);
	});
});
