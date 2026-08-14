import { describe, expect, test } from "bun:test";
import { canSyncNitToOpportunities } from "./lead-nit-sync";

describe("canSyncNitToOpportunities", () => {
	test("sincroniza cuando el lead tiene una sola oportunidad", () => {
		expect(canSyncNitToOpportunities(["120334941"])).toBe(true);
	});

	test("sincroniza cuando todas las oportunidades tienen el mismo NIT", () => {
		expect(
			canSyncNitToOpportunities(["120334941", "120334941", "120334941"]),
		).toBe(true);
	});

	test("no sincroniza cuando una oportunidad tiene un NIT corregido", () => {
		expect(canSyncNitToOpportunities(["120334941", "94825693"])).toBe(false);
	});

	test("no sincroniza cuando solo una de las oportunidades tiene NIT", () => {
		expect(canSyncNitToOpportunities(["120334941", null])).toBe(false);
	});

	test("sincroniza cuando ninguna oportunidad tiene NIT todavía", () => {
		expect(canSyncNitToOpportunities([null, "", "   "])).toBe(true);
	});

	test("ignora guiones, espacios y mayúsculas al comparar", () => {
		expect(canSyncNitToOpportunities(["1203349-41", "120334941"])).toBe(true);
		expect(canSyncNitToOpportunities(["cf", "CF"])).toBe(true);
	});

	test("no sincroniza cuando el lead no tiene oportunidades", () => {
		expect(canSyncNitToOpportunities([])).toBe(false);
	});
});
