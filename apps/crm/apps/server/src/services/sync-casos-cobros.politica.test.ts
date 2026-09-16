import { describe, expect, it } from "bun:test";
import { debeCrearCasoCobros } from "./sync-casos-cobros.politica";

describe("debeCrearCasoCobros", () => {
	it("ACTIVO y MOROSO necesitan días de mora", () => {
		expect(debeCrearCasoCobros("MOROSO", 5)).toBe(true);
		expect(debeCrearCasoCobros("ACTIVO", 1)).toBe(true);
		expect(debeCrearCasoCobros("MOROSO", 0)).toBe(false);
		expect(debeCrearCasoCobros("ACTIVO", 0)).toBe(false);
	});

	// Pagó las cuotas pero no la mora: la recuperación se mantiene a propósito
	// (decisión 18) con 0 días calculados sobre cuotas. Con el gate de días la
	// sync le cerraba el caso mientras el vehículo seguía en recuperación
	// (review de Codex, P1).
	it("EN_RECUPERACION conserva el caso aunque no tenga cuotas vencidas", () => {
		expect(debeCrearCasoCobros("EN_RECUPERACION", 0)).toBe(true);
		expect(debeCrearCasoCobros("EN_RECUPERACION", 40)).toBe(true);
	});

	it("los estados fuera del ciclo de cobro no crean caso", () => {
		expect(debeCrearCasoCobros("CANCELADO", 30)).toBe(false);
		expect(debeCrearCasoCobros("EN_CONVENIO", 30)).toBe(false);
	});
});
