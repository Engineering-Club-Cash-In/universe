import { describe, expect, test } from "bun:test";
import { createContactoCobrosSchema } from "./cobros";

/**
 * CB-020 (Codex, PR #1147): los 2 .refine() de promesa_pago (rango/mora
 * obligatorio, fecha obligatoria) estuvieron comentados por varias rondas
 * mientras el web viejo no los soportaba — se repusieron cuando el web nuevo
 * se mergeó (PR #1147). Este test es la regresión que faltaba: si alguien
 * vuelve a comentarlos o los rompe sin querer, esto lo atrapa antes de
 * producción.
 */

function base(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		casoCobroId: "00000000-0000-0000-0000-000000000000",
		metodoContacto: "llamada" as const,
		estadoContacto: "promesa_pago" as const,
		comentarios: "Cliente confirmó pago",
		requiereSeguimiento: true,
		fechaProximoContacto: new Date("2026-08-01"),
		incluyeMora: false,
		...overrides,
	};
}

describe("createContactoCobrosSchema — promesa_pago", () => {
	test("rango de cuotas sin mora → válido", () => {
		const result = createContactoCobrosSchema.safeParse(
			base({ cuotaInicio: 1, cuotaFin: 2 }),
		);
		expect(result.success).toBe(true);
	});

	test("solo mora sin rango → válido", () => {
		const result = createContactoCobrosSchema.safeParse(
			base({ incluyeMora: true }),
		);
		expect(result.success).toBe(true);
	});

	test("sin rango Y sin mora → inválido (regla repuesta)", () => {
		const result = createContactoCobrosSchema.safeParse(base());
		expect(result.success).toBe(false);
	});

	test("sin fechaProximoContacto → inválido (regla repuesta)", () => {
		const result = createContactoCobrosSchema.safeParse(
			base({ cuotaInicio: 1, cuotaFin: 1, fechaProximoContacto: undefined }),
		);
		expect(result.success).toBe(false);
	});

	test("rango a medias (solo cuotaInicio) → inválido", () => {
		const result = createContactoCobrosSchema.safeParse(
			base({ cuotaInicio: 1, incluyeMora: true }),
		);
		expect(result.success).toBe(false);
	});

	test("cuotaFin menor que cuotaInicio → inválido", () => {
		const result = createContactoCobrosSchema.safeParse(
			base({ cuotaInicio: 5, cuotaFin: 2 }),
		);
		expect(result.success).toBe(false);
	});

	test("estadoContacto distinto de promesa_pago → reglas de promesa no aplican", () => {
		const result = createContactoCobrosSchema.safeParse(
			base({
				estadoContacto: "contactado",
				fechaProximoContacto: undefined,
				requiereSeguimiento: false,
			}),
		);
		expect(result.success).toBe(true);
	});
});
