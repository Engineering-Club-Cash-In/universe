import { describe, expect, test } from "bun:test";
import {
	esPromesaActiva,
	type PromesaContactoUI,
	tienePromesaActiva,
} from "./promesa-activa";

function promesaFixture(
	overrides: Partial<PromesaContactoUI> = {},
): PromesaContactoUI {
	return {
		id: "p1",
		estadoContacto: "promesa_pago",
		fechaProximoContacto: "2026-07-22T06:00:00.000Z",
		estadoPromesa: "pendiente",
		...overrides,
	};
}

describe("esPromesaActiva", () => {
	test("promesa_pago + fecha + pendiente → activa", () => {
		expect(esPromesaActiva(promesaFixture())).toBe(true);
	});

	test("promesa_pago + fecha + incumplida → activa (incumplida NO es terminal)", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoPromesa: "incumplida" })),
		).toBe(true);
	});

	test("promesa_pago + fecha + estadoPromesa null/legacy → activa", () => {
		expect(esPromesaActiva(promesaFixture({ estadoPromesa: null }))).toBe(true);
	});

	test("promesa_pago + fecha + cumplida → NO activa (TERMINAL)", () => {
		expect(esPromesaActiva(promesaFixture({ estadoPromesa: "cumplida" }))).toBe(
			false,
		);
	});

	test("sin fechaProximoContacto → NO activa", () => {
		expect(
			esPromesaActiva(promesaFixture({ fechaProximoContacto: null })),
		).toBe(false);
	});

	test("estadoContacto distinto de promesa_pago → NO activa", () => {
		expect(
			esPromesaActiva(promesaFixture({ estadoContacto: "contactado" })),
		).toBe(false);
	});

	test("estadoContacto null/undefined → NO activa", () => {
		expect(esPromesaActiva(promesaFixture({ estadoContacto: null }))).toBe(
			false,
		);
	});

	test("fecha pasada + pendiente → sigue activa (gracia la evalúa otro código)", () => {
		expect(
			esPromesaActiva(
				promesaFixture({ fechaProximoContacto: "2020-01-01T00:00:00.000Z" }),
			),
		).toBe(true);
	});
});

describe("tienePromesaActiva — precedencia memoria > DB", () => {
	test("lista vacía → false", () => {
		expect(tienePromesaActiva([])).toBe(false);
	});

	test("una activa en DB, sin estadosEnMemoria → true", () => {
		expect(tienePromesaActiva([promesaFixture()])).toBe(true);
	});

	test("DB dice pendiente pero memoria dice cumplida → false (memoria gana)", () => {
		expect(tienePromesaActiva([promesaFixture()], { p1: "cumplida" })).toBe(
			false,
		);
	});

	test("DB dice cumplida pero memoria dice incumplida → true (memoria gana)", () => {
		expect(
			tienePromesaActiva([promesaFixture({ estadoPromesa: "cumplida" })], {
				p1: "incumplida",
			}),
		).toBe(true);
	});

	test("memoria no trae el id → cae a la columna DB", () => {
		expect(tienePromesaActiva([promesaFixture()], { otroId: "cumplida" })).toBe(
			true,
		);
	});

	test("3 promesas, solo la 2ª activa → true", () => {
		const promesas = [
			promesaFixture({ id: "p1", estadoPromesa: "cumplida" }),
			promesaFixture({ id: "p2", estadoPromesa: "pendiente" }),
			promesaFixture({ id: "p3", estadoContacto: "contactado" }),
		];
		expect(tienePromesaActiva(promesas)).toBe(true);
	});

	test("3 promesas, todas cumplidas → false", () => {
		const promesas = [
			promesaFixture({ id: "p1", estadoPromesa: "cumplida" }),
			promesaFixture({ id: "p2", estadoPromesa: "cumplida" }),
			promesaFixture({ id: "p3", estadoPromesa: "cumplida" }),
		];
		expect(tienePromesaActiva(promesas)).toBe(false);
	});
});
