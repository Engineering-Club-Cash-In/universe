import { describe, expect, it } from "bun:test";
import { decidirEnvioReconciliacion } from "./reconciliacion-promesas";

/**
 * CB-030 — la regla que evita que un problema de datos se convierta en un
 * unfreeze masivo del espejo de promesas en cartera-back.
 */
describe("decidirEnvioReconciliacion", () => {
	it("payload con contenido → envía", () => {
		expect(decidirEnvioReconciliacion(5, 5)).toEqual({ enviar: true });
	});

	it("payload parcial (algunas sin SIFCO) → envía igual, las resueltas valen", () => {
		expect(decidirEnvioReconciliacion(5, 3)).toEqual({ enviar: true });
	});

	it("cero promesas vigentes hoy → envía batch vacío (limpia el espejo; única forma de desactivar la última promesa si su push se perdió)", () => {
		expect(decidirEnvioReconciliacion(0, 0)).toEqual({ enviar: true });
	});

	it("había promesas vigentes pero NINGUNA resolvió a un caso con SIFCO → NO envía (batch vacío destrabaría el freeze de promesas todavía vigentes)", () => {
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
