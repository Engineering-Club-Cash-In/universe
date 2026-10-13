import { describe, expect, test } from "bun:test";
import {
	compararEntradas,
	decisionDe,
	type EntradaBitacora,
	estadosNativos,
	MAX_FILAS_BITACORA,
	mensajeFueraDeAlcance,
	paginarMezcla,
} from "./bitacora-supervision";

function entrada(id: string, fecha: string): EntradaBitacora {
	return {
		id,
		tipo: "apagado",
		fecha,
		decision: "aprobada",
		estado: "aprobada",
		solicitante: null,
		decididoPor: null,
		credito: null,
		resumen: null,
		motivo: null,
		nota: null,
		refId: id,
	};
}

describe("estadosNativos", () => {
	test("aprobada de un apagado incluye los ya ejecutados", () => {
		expect(estadosNativos("inmovilizacion", ["aprobada"])).toEqual([
			"aprobada",
			"ejecutada",
		]);
	});

	test("sin filtro trae todo lo decidido y nada pendiente", () => {
		const todos = estadosNativos("rebaja");
		expect(todos).toContain("aplicada");
		expect(todos).toContain("rechazada");
		expect(todos).not.toContain("pendiente");
	});

	test("una decisión que la fuente no tiene no trae nada", () => {
		expect(estadosNativos("convenio", ["sin_efecto"])).toEqual([]);
		expect(estadosNativos("convenio", ["cancelada"])).toEqual([]);
	});
});

describe("decisionDe", () => {
	test("traduce el estado propio", () => {
		expect(decisionDe("inmovilizacion", "ejecutada")).toBe("aprobada");
		expect(decisionDe("convenio", "rechazado")).toBe("rechazada");
		expect(decisionDe("recuperacion", "sin_efecto")).toBe("sin_efecto");
		expect(decisionDe("rebaja", "pendiente")).toBeNull();
	});
});

describe("paginarMezcla", () => {
	test("mezcla por fecha y corta la página exacta", () => {
		const a = {
			filas: [entrada("a1", "2026-10-05"), entrada("a2", "2026-10-01")],
			total: 5,
		};
		const b = {
			filas: [entrada("b1", "2026-10-04"), entrada("b2", "2026-10-03")],
			total: 2,
		};
		const p1 = paginarMezcla([a, b], 1, 3);
		expect(p1.items.map((i) => i.id)).toEqual(["a1", "b1", "b2"]);
		expect(p1.total).toBe(7);
		expect(p1.totalPages).toBe(3);
		const p2 = paginarMezcla([a, b], 2, 3);
		expect(p2.items.map((i) => i.id)).toEqual(["a2"]);
	});

	test("empata por id para que la página sea estable", () => {
		const f = {
			filas: [entrada("x", "2026-10-01"), entrada("y", "2026-10-01")],
			total: 2,
		};
		expect(paginarMezcla([f], 1, 10).items.map((i) => i.id)).toEqual([
			"y",
			"x",
		]);
	});

	test("empata por el id numérico de la fila, no por el texto (999 vs 1000)", () => {
		const fecha = "2026-10-01";
		const ids = ["reasignacion-999", "reasignacion-1000", "reasignacion-998"];
		const orden = ids
			.map((id) => entrada(id, fecha))
			.sort(compararEntradas)
			.map((e) => e.id);
		expect(orden).toEqual([
			"reasignacion-1000",
			"reasignacion-999",
			"reasignacion-998",
		]);
	});

	test("al pedir más filas por fuente no cambia lo ya visto", () => {
		const todas = Array.from({ length: 1005 }, (_, i) =>
			entrada(`reasignacion-${1005 - i}`, "2026-10-01"),
		);
		const fuente = (n: number) => ({ filas: todas.slice(0, n), total: 1005 });
		const antes = paginarMezcla([fuente(5)], 1, 5).items.map((i) => i.id);
		const mas = paginarMezcla([fuente(1005)], 1, 5).items.map((i) => i.id);
		expect(mas).toEqual(antes);
	});

	test("sin datos devuelve una página vacía", () => {
		const r = paginarMezcla([{ filas: [], total: 0 }], 1, 25);
		expect(r.items).toEqual([]);
		expect(r.totalPages).toBe(1);
	});
});

describe("mensajeFueraDeAlcance", () => {
	test("deja pasar hasta el límite de entradas", () => {
		expect(mensajeFueraDeAlcance(1, 50)).toBeNull();
		expect(mensajeFueraDeAlcance(100, 50)).toBeNull();
		expect(MAX_FILAS_BITACORA).toBe(5000);
	});

	test("más allá del límite explica cómo seguir", () => {
		expect(mensajeFueraDeAlcance(101, 50)).toContain(
			"acote el rango de fechas",
		);
		expect(mensajeFueraDeAlcance(2, 3000)).not.toBeNull();
	});
});
