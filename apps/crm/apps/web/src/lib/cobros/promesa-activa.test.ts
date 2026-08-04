import { describe, expect, test } from "bun:test";
import {
	esPromesaActiva,
	inicioDelDiaGT,
	type PromesaContactoUI,
	tienePromesaActiva,
} from "./promesa-activa";

// Reloj fijo para todos los casos: 2026-07-22 10:00 GT (= 16:00 UTC). Así el
// predicado se prueba contra fechas relativas conocidas y no contra el día en
// que corra la suite.
const AHORA = new Date("2026-07-22T16:00:00.000Z");
const HOY_GT = "2026-07-22T06:00:00.000Z"; // medianoche GT de hoy
const MANANA_GT = "2026-07-23T06:00:00.000Z";
const AYER_GT = "2026-07-21T06:00:00.000Z";

function promesaFixture(
	overrides: Partial<PromesaContactoUI> = {},
): PromesaContactoUI {
	return {
		id: "p1",
		estadoContacto: "promesa_pago",
		fechaProximoContacto: MANANA_GT,
		estadoPromesa: "pendiente",
		...overrides,
	};
}

describe("inicioDelDiaGT", () => {
	test("devuelve medianoche GT del día en curso (06:00 UTC)", () => {
		expect(inicioDelDiaGT(AHORA).toISOString()).toBe(HOY_GT);
	});

	test("a las 23:00 GT sigue siendo el mismo día GT, no el siguiente en UTC", () => {
		// 2026-07-23T05:00Z = 2026-07-22 23:00 GT
		expect(
			inicioDelDiaGT(new Date("2026-07-23T05:00:00.000Z")).toISOString(),
		).toBe(HOY_GT);
	});
});

describe("esPromesaActiva", () => {
	test("promesa_pago + fecha futura + pendiente → activa", () => {
		expect(esPromesaActiva(promesaFixture(), AHORA)).toBe(true);
	});

	test("fecha prometida es HOY → sigue activa el día entero", () => {
		expect(
			esPromesaActiva(promesaFixture({ fechaProximoContacto: HOY_GT }), AHORA),
		).toBe(true);
	});

	test("promesa_pago + fecha futura + estadoPromesa null/legacy → activa", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoPromesa: null }), AHORA),
		).toBe(true);
	});

	test("incumplida → NO activa (ya fracasó; el freeze tampoco aplica)", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoPromesa: "incumplida" }), AHORA),
		).toBe(false);
	});

	test("cumplida → NO activa (TERMINAL)", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoPromesa: "cumplida" }), AHORA),
		).toBe(false);
	});

	test("fecha VENCIDA aunque siga pendiente → NO activa (Codex PR #1238)", () => {
		expect(
			esPromesaActiva(promesaFixture({ fechaProximoContacto: AYER_GT }), AHORA),
		).toBe(false);
	});

	test("sin fechaProximoContacto → NO activa", () => {
		expect(
			esPromesaActiva(promesaFixture({ fechaProximoContacto: null }), AHORA),
		).toBe(false);
	});

	test("fecha inválida → NO activa (no NaN silencioso)", () => {
		expect(
			esPromesaActiva(
				promesaFixture({ fechaProximoContacto: "no-es-fecha" }),
				AHORA,
			),
		).toBe(false);
	});

	test("acepta Date además de string", () => {
		expect(
			esPromesaActiva(
				promesaFixture({ fechaProximoContacto: new Date(MANANA_GT) }),
				AHORA,
			),
		).toBe(true);
	});

	test("estadoContacto distinto de promesa_pago → NO activa", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoContacto: "contactado" }), AHORA),
		).toBe(false);
	});

	test("estadoContacto null/undefined → NO activa", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoContacto: null }), AHORA),
		).toBe(false);
	});
});

describe("tienePromesaActiva — precedencia memoria > DB", () => {
	test("lista vacía → false", () => {
		expect(tienePromesaActiva([], undefined, AHORA)).toBe(false);
	});

	test("una activa en DB, sin estadosEnMemoria → true", () => {
		expect(tienePromesaActiva([promesaFixture()], undefined, AHORA)).toBe(true);
	});

	test("DB dice pendiente pero memoria dice cumplida → false (memoria gana)", () => {
		expect(
			tienePromesaActiva([promesaFixture()], { p1: "cumplida" }, AHORA),
		).toBe(false);
	});

	test("DB dice pendiente pero memoria dice incumplida → false (memoria gana)", () => {
		expect(
			tienePromesaActiva([promesaFixture()], { p1: "incumplida" }, AHORA),
		).toBe(false);
	});

	test("DB dice cumplida pero memoria dice pendiente → true (memoria gana)", () => {
		expect(
			tienePromesaActiva(
				[promesaFixture({ estadoPromesa: "cumplida" })],
				{ p1: "pendiente" },
				AHORA,
			),
		).toBe(true);
	});

	test("memoria no trae el id → cae a la columna DB", () => {
		expect(
			tienePromesaActiva([promesaFixture()], { otroId: "cumplida" }, AHORA),
		).toBe(true);
	});

	test("3 promesas, solo la 2ª activa → true", () => {
		const promesas = [
			promesaFixture({ id: "p1", estadoPromesa: "cumplida" }),
			promesaFixture({ id: "p2", estadoPromesa: "pendiente" }),
			promesaFixture({ id: "p3", estadoContacto: "contactado" }),
		];
		expect(tienePromesaActiva(promesas, undefined, AHORA)).toBe(true);
	});

	test("3 promesas pendientes pero TODAS vencidas → false", () => {
		const promesas = [
			promesaFixture({ id: "p1", fechaProximoContacto: AYER_GT }),
			promesaFixture({ id: "p2", fechaProximoContacto: AYER_GT }),
			promesaFixture({ id: "p3", fechaProximoContacto: AYER_GT }),
		];
		expect(tienePromesaActiva(promesas, undefined, AHORA)).toBe(false);
	});

	test("3 promesas, todas cumplidas → false", () => {
		const promesas = [
			promesaFixture({ id: "p1", estadoPromesa: "cumplida" }),
			promesaFixture({ id: "p2", estadoPromesa: "cumplida" }),
			promesaFixture({ id: "p3", estadoPromesa: "cumplida" }),
		];
		expect(tienePromesaActiva(promesas, undefined, AHORA)).toBe(false);
	});
});
