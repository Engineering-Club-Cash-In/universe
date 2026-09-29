import { describe, expect, test } from "bun:test";
import {
	coincideFiltroCobros,
	esPrioritaria,
	FILTRO_COBROS_TAREAS,
	FILTRO_COBROS_TODAS,
	ordenarPorPrioridad,
	tareaVencida,
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

describe("coincideFiltroCobros — grupo de tareas (CB-035)", () => {
	test("deja la tarea B3; excluye su alerta de vencida, otras alertas y no-cobros", () => {
		expect(
			coincideFiltroCobros(
				{ cobrosTipo: "b3_llamada_supervisor" },
				FILTRO_COBROS_TAREAS,
			),
		).toBe(true);
		expect(
			coincideFiltroCobros(
				{ cobrosTipo: "b3_llamada_vencida" },
				FILTRO_COBROS_TAREAS,
			),
		).toBe(false);
		expect(
			coincideFiltroCobros(
				{ cobrosTipo: "sin_contacto_3d" },
				FILTRO_COBROS_TAREAS,
			),
		).toBe(false);
		expect(
			coincideFiltroCobros({ cobrosTipo: null }, FILTRO_COBROS_TAREAS),
		).toBe(false);
	});
});

describe("tareaVencida", () => {
	// Vence jue 2025-02-13 23:59:59 GT.
	const VENCE = new Date("2025-02-14T05:59:59.999Z");

	test("el día límite todavía no venció", () => {
		expect(tareaVencida(VENCE, new Date("2025-02-14T05:59:00.000Z"))).toBe(
			false,
		);
	});

	test("desde las 00:00 GT del día siguiente venció", () => {
		expect(tareaVencida(VENCE, new Date("2025-02-14T06:00:00.000Z"))).toBe(
			true,
		);
	});
});
