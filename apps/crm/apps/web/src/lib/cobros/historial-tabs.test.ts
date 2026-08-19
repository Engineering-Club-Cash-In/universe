import { describe, expect, test } from "bun:test";
import { tabsHistorialCobros } from "./historial-tabs";

describe("tabsHistorialCobros", () => {
	test("admin y supervisor ven historial y cumplimiento", () => {
		expect(tabsHistorialCobros("admin")).toEqual(["historial", "cumplimiento"]);
		expect(tabsHistorialCobros("cobros_supervisor")).toEqual([
			"historial",
			"cumplimiento",
		]);
	});

	test("asesor solo ve historial", () => {
		expect(tabsHistorialCobros("cobros")).toEqual(["historial"]);
	});
});
