import { describe, expect, test } from "bun:test";
import { canSyncNitToOpportunity } from "./lead-nit-sync";

describe("canSyncNitToOpportunity", () => {
	test("sincroniza la oportunidad que sigue con la copia del lead", () => {
		expect(canSyncNitToOpportunity("120334941", "120334941")).toBe(true);
	});

	test("no sincroniza la oportunidad con el NIT corregido a mano", () => {
		// El caso que el fix anterior dejaba pasar cuando el lead tenía una sola
		// oportunidad: lead con NIT A, oportunidad corregida a B en el detalle de
		// crédito (40%). Editar el lead a C no debe pisar la B.
		expect(canSyncNitToOpportunity("94825693", "120334941")).toBe(false);
	});

	test("sincroniza la oportunidad que todavía no tiene NIT", () => {
		expect(canSyncNitToOpportunity(null, "120334941")).toBe(true);
		expect(canSyncNitToOpportunity("", "120334941")).toBe(true);
		expect(canSyncNitToOpportunity("   ", null)).toBe(true);
	});

	test("no sincroniza si el lead no tenía NIT y la oportunidad sí", () => {
		expect(canSyncNitToOpportunity("120334941", null)).toBe(false);
		expect(canSyncNitToOpportunity("120334941", "")).toBe(false);
	});

	test("ignora guiones, espacios y mayúsculas al comparar", () => {
		expect(canSyncNitToOpportunity("1203349-41", "120334941")).toBe(true);
		expect(canSyncNitToOpportunity("120334941", "1203349 41")).toBe(true);
		expect(canSyncNitToOpportunity("cf", "CF")).toBe(true);
	});
});
