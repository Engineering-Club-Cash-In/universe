import { describe, expect, test } from "bun:test";
import {
	admiteEvento,
	coincideBusqueda,
	compararEntradas,
	decisionDe,
	type EntradaBitacora,
	estadoContrapropuesta,
	estadosNativos,
	eventoDeTraslado,
	leerBusqueda,
	MAX_FILAS_BITACORA,
	mensajeFueraDeAlcance,
	paginarMezcla,
	TIPOS_SIN_CREDITO,
	TIPOS_SOLICITUD,
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

describe("documentos y contrapropuestas", () => {
	test("un documento es una solicitud con aprobada y rechazada", () => {
		expect(TIPOS_SOLICITUD).toContain("documento");
		expect(estadosNativos("documento")).toEqual(["aprobada", "rechazada"]);
		expect(estadosNativos("documento", ["cancelada"])).toEqual([]);
		expect(decisionDe("documento", "pendiente")).toBeNull();
	});

	test("una contrapropuesta descartada por un supervisor es «retirada»", () => {
		expect(estadoContrapropuesta("descartada", "cobros_supervisor")).toBe(
			"retirada",
		);
		expect(estadoContrapropuesta("descartada", "admin")).toBe("retirada");
		expect(estadoContrapropuesta("descartada", "cobros")).toBe("descartada");
		expect(estadoContrapropuesta("descartada", null)).toBe("descartada");
		expect(estadoContrapropuesta("aceptada", "cobros")).toBe("aceptada");
		expect(estadoContrapropuesta("sin_efecto", null)).toBe("sin_efecto");
	});
});

describe("eventos de los asesores", () => {
	test("despido o renuncia es una baja; lo demás, un traslado", () => {
		expect(eventoDeTraslado("Despido: abandono de labores")).toBe("baja");
		expect(eventoDeTraslado("Renuncia")).toBe("baja");
		expect(eventoDeTraslado("  renuncia: último día el viernes")).toBe("baja");
		expect(eventoDeTraslado("Redistribución de cartera")).toBe("traslado");
		expect(eventoDeTraslado("Renunciaron los clientes")).toBe("traslado");
		expect(eventoDeTraslado(null)).toBe("traslado");
	});

	test("sin eventos pedidos entra todo; con eventos, solo esos", () => {
		expect(admiteEvento("baja")).toBe(true);
		expect(admiteEvento("baja", [])).toBe(true);
		expect(admiteEvento("baja", ["traslado"])).toBe(false);
		expect(admiteEvento("reactivacion", ["ausencia", "reactivacion"])).toBe(
			true,
		);
	});

	test("las acciones sobre asesores no tienen crédito", () => {
		expect(TIPOS_SIN_CREDITO).toEqual([
			"traslado",
			"cobertura",
			"ausencia_indefinida",
		]);
	});
});

describe("búsqueda por texto", () => {
	test("un número busca en el SIFCO", () => {
		expect(leerBusqueda(" #0101-0214 047120 ")).toEqual({
			tipo: "sifco",
			digitos: "01010214047120",
		});
	});

	test("un nombre se parte en palabras sin tildes ni mayúsculas", () => {
		expect(leerBusqueda("  María   LÓPEZ ")).toEqual({
			tipo: "nombre",
			palabras: ["maria", "lopez"],
			texto: "María   LÓPEZ",
		});
	});

	test("vacío no busca", () => {
		expect(leerBusqueda("")).toBeNull();
		expect(leerBusqueda("   ")).toBeNull();
		expect(leerBusqueda(undefined)).toBeNull();
	});

	test("el nombre necesita todas las palabras, en cualquier orden", () => {
		const b = leerBusqueda("lopez maria");
		if (!b) throw new Error("sin búsqueda");
		const credito = { sifco: "01010214047120", cliente: "María José López" };
		expect(coincideBusqueda(b, credito)).toBe(true);
		const otra = leerBusqueda("lopez carlos");
		if (!otra) throw new Error("sin búsqueda");
		expect(coincideBusqueda(otra, credito)).toBe(false);
	});

	test("el número se busca dentro del SIFCO", () => {
		const b = leerBusqueda("47120");
		if (!b) throw new Error("sin búsqueda");
		expect(
			coincideBusqueda(b, { sifco: "01010214047120", cliente: null }),
		).toBe(true);
		expect(coincideBusqueda(b, { sifco: null, cliente: "47120" })).toBe(false);
	});
});
