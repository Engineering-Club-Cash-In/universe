import { describe, expect, it } from "bun:test";
import { decidirEnvioReconciliacion } from "./reconciliacion-promesas";

/**
 * CB-030 — la regla que evita que un problema de datos se convierta en un
 * unfreeze del espejo de promesas en cartera-back.
 */
describe("decidirEnvioReconciliacion", () => {
	it("todas las promesas resolvieron → batch completo, se declara como tal", () => {
		expect(decidirEnvioReconciliacion(5, 5)).toEqual({
			enviar: true,
			modo: "reconciliacion_completa",
		});
	});

	it("cero promesas vigentes hoy → batch vacío declarado completo (única forma de desactivar la última promesa si su push se perdió)", () => {
		expect(decidirEnvioReconciliacion(0, 0)).toEqual({
			enviar: true,
			modo: "reconciliacion_completa",
		});
	});

	it("batch PARCIAL (alguna vigente sin SIFCO) → se envía degradado a 'evento': las ausentes siguen vigentes, declarar completo las destrabaría (Codex PR #1237)", () => {
		expect(decidirEnvioReconciliacion(5, 4)).toEqual({
			enviar: true,
			modo: "evento",
			motivo: "drift_parcial",
		});
	});

	it("una sola sin resolver de un lote grande → igual degrada (basta una para que el set no sea completo)", () => {
		expect(decidirEnvioReconciliacion(100, 99)).toEqual({
			enviar: true,
			modo: "evento",
			motivo: "drift_parcial",
		});
	});

	it("había promesas vigentes pero NINGUNA resolvió → NO envía (batch vacío apagaría todo el espejo)", () => {
		expect(decidirEnvioReconciliacion(5, 0)).toEqual({
			enviar: false,
			motivo: "drift_sin_sifco",
		});
	});

	it("una sola promesa vigente que no resuelve → tampoco envía (el filo no depende del volumen)", () => {
		expect(decidirEnvioReconciliacion(1, 0)).toEqual({
			enviar: false,
			motivo: "drift_sin_sifco",
		});
	});
});
