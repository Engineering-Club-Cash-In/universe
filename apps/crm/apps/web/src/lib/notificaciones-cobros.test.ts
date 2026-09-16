import { describe, expect, test } from "bun:test";
import {
	coincideFiltroCobros,
	esPrioritaria,
	FILTRO_COBROS_TODAS,
	ordenarPorPrioridad,
} from "./notificaciones-cobros";

const n = (
	id: string,
	cobrosTipo: string | null,
	status: string,
	createdAt: string,
) => ({ id, cobrosTipo, status, createdAt });

describe("ordenarPorPrioridad", () => {
	test("un cliente esperando en modo agente sube arriba aunque sea más viejo", () => {
		const orden = ordenarPorPrioridad([
			n("nueva", "cliente_subido", "pending", "2026-09-16T12:00:00Z"),
			n("agente", "bot_modo_agente", "pending", "2026-09-16T08:00:00Z"),
			n("otra", null, "pending", "2026-09-16T10:00:00Z"),
		]);
		expect(orden.map((x) => x.id)).toEqual(["agente", "nueva", "otra"]);
	});

	test("ya resuelta deja de ser prioritaria y vuelve a su fecha", () => {
		const orden = ordenarPorPrioridad([
			n("nueva", "cliente_subido", "pending", "2026-09-16T12:00:00Z"),
			n("agente", "bot_modo_agente", "resolved", "2026-09-16T08:00:00Z"),
		]);
		expect(orden.map((x) => x.id)).toEqual(["nueva", "agente"]);
	});

	test("entre prioritarias manda la más reciente", () => {
		const orden = ordenarPorPrioridad([
			n("vieja", "bot_modo_agente", "read", "2026-09-16T08:00:00Z"),
			n("reciente", "bot_modo_agente", "pending", "2026-09-16T09:00:00Z"),
		]);
		expect(orden.map((x) => x.id)).toEqual(["reciente", "vieja"]);
	});

	test("no muta la lista original", () => {
		const lista = [
			n("a", null, "pending", "2026-09-16T08:00:00Z"),
			n("b", "bot_modo_agente", "pending", "2026-09-16T07:00:00Z"),
		];
		ordenarPorPrioridad(lista);
		expect(lista[0].id).toBe("a");
	});
});

describe("esPrioritaria", () => {
	test("solo el modo agente abierto", () => {
		expect(
			esPrioritaria(n("x", "bot_modo_agente", "in_progress", "2026-09-16")),
		).toBe(true);
		expect(
			esPrioritaria(n("x", "bot_modo_agente", "dismissed", "2026-09-16")),
		).toBe(false);
		expect(
			esPrioritaria(n("x", "bot_cliente_escribio", "pending", "2026-09-16")),
		).toBe(false);
	});
});

describe("coincideFiltroCobros", () => {
	test("all no filtra; el genérico deja solo cobros; un tipo es exacto", () => {
		const cobros = { cobrosTipo: "bot_modo_agente" };
		const otra = { cobrosTipo: null };
		expect(coincideFiltroCobros(otra, "all")).toBe(true);
		expect(coincideFiltroCobros(cobros, FILTRO_COBROS_TODAS)).toBe(true);
		expect(coincideFiltroCobros(otra, FILTRO_COBROS_TODAS)).toBe(false);
		expect(coincideFiltroCobros(cobros, "bot_modo_agente")).toBe(true);
		expect(coincideFiltroCobros(cobros, "cliente_subido")).toBe(false);
	});
});
