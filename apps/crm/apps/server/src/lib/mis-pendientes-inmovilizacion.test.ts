import { describe, expect, it } from "bun:test";
import {
	armarPendientes,
	type FilaPendiente,
	filasDelUsuario,
} from "./mis-pendientes-inmovilizacion";

const fila = (parcial: Partial<FilaPendiente> = {}): FilaPendiente => ({
	inmovilizacionId: "i-1",
	casoId: "c-1",
	numeroCreditoSifco: "01010214100000",
	accion: "apagado",
	estado: "aprobada",
	decididoAt: new Date("2026-10-01T10:00:00Z"),
	ejecutadoAt: null,
	destinatario: "asesor-viejo",
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

describe("filasDelUsuario", () => {
	it("si cartera reasignó el crédito, es del dueño actual y no del destinatario del aviso", () => {
		const duenos = new Map([["01010214100000", "asesor-nuevo"]]);
		const filas = [fila({ destinatario: "asesor-viejo" })];

		expect(filasDelUsuario(filas, duenos, "asesor-viejo")).toHaveLength(0);
		expect(filasDelUsuario(filas, duenos, "asesor-nuevo")).toHaveLength(1);
	});

	it("el dueño actual la ve aunque nunca haya recibido el aviso", () => {
		const duenos = new Map([["01010214100000", "asesor-nuevo"]]);
		// Sin aviso: el respaldo es quien pidió el trámite, otra persona.
		const filas = [fila({ destinatario: "quien-lo-pidio" })];

		expect(filasDelUsuario(filas, duenos, "asesor-nuevo")).toHaveLength(1);
	});

	it("sin dueño conocido (cartera no respondió o sin usuario en el CRM) cae al destinatario", () => {
		const filas = [fila({ destinatario: "asesor-viejo" })];

		expect(filasDelUsuario(filas, new Map(), "asesor-viejo")).toHaveLength(1);
		expect(filasDelUsuario(filas, new Map(), "otro")).toHaveLength(0);
	});

	it("sin dueño ni destinatario no es de nadie", () => {
		const filas = [fila({ destinatario: null })];

		expect(filasDelUsuario(filas, new Map(), "asesor-viejo")).toHaveLength(0);
	});

	it("resuelve cada crédito por separado", () => {
		const duenos = new Map([
			["S-A", "ana"],
			["S-B", "beto"],
		]);
		const filas = [
			fila({ inmovilizacionId: "a", numeroCreditoSifco: "S-A" }),
			fila({ inmovilizacionId: "b", numeroCreditoSifco: "S-B" }),
		];

		expect(
			filasDelUsuario(filas, duenos, "ana").map((f) => f.inmovilizacionId),
		).toEqual(["a"]);
	});
});
