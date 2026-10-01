/**
 * CB-039 · Reglas de la investigación en redes sociales (lib pura): en qué
 * buckets se puede registrar y qué exige el formulario.
 */
import { describe, expect, it } from "bun:test";
import {
	BUCKETS_INVESTIGACION,
	erroresRegistroInvestigacion,
	etiquetaFuenteInvestigacion,
	investigacionPermitidaEnBucket,
	motivoBloqueoInvestigacion,
	type RegistrarInvestigacionInput,
	registrarInvestigacionSchema,
	textoBucketsInvestigacion,
} from "./investigaciones-redes-cobros";

const AHORA = new Date("2026-10-01T16:00:00.000Z");
const CASO = "71af2e4d-22c1-4aa8-869d-be4d56675e2a";

const registro = (extra: Partial<RegistrarInvestigacionInput> = {}) =>
	registrarInvestigacionSchema.parse({
		casoCobroId: CASO,
		fuente: "facebook",
		resultado: "con_hallazgos",
		hallazgos: "Perfil público con foto del vehículo y lugar de trabajo.",
		fechaInvestigacion: new Date(AHORA.getTime() - 30 * 60_000),
		...extra,
	});

describe("buckets", () => {
	it("hoy B2 y B3", () => {
		expect([0, 1, 2, 3, 4, 5].map(investigacionPermitidaEnBucket)).toEqual([
			false,
			false,
			true,
			true,
			false,
			false,
		]);
		expect(investigacionPermitidaEnBucket(null)).toBe(false);
		expect(BUCKETS_INVESTIGACION).toEqual([2, 3]);
	});

	it("el texto de buckets se arma desde la lista", () => {
		expect(textoBucketsInvestigacion([2])).toBe("B2");
		expect(textoBucketsInvestigacion([2, 3])).toBe("B2 y B3");
		expect(textoBucketsInvestigacion([4, 2, 3])).toBe("B2, B3 y B4");
	});

	it("el motivo dice dónde está el caso", () => {
		expect(motivoBloqueoInvestigacion(2)).toBeNull();
		expect(motivoBloqueoInvestigacion(4, "B4")).toBe(
			"Disponible en B2 y B3. Este caso está en B4.",
		);
		expect(motivoBloqueoInvestigacion(1)).toBe(
			"Disponible en B2 y B3. Este caso está en B1.",
		);
		expect(motivoBloqueoInvestigacion(null)).toContain("no tiene bucket");
	});
});

describe("formulario", () => {
	it("un registro completo no tiene errores", () => {
		expect(erroresRegistroInvestigacion(registro(), AHORA)).toBeNull();
	});

	it("exige hallazgos con un mínimo de texto", () => {
		expect(() => registro({ hallazgos: "corto" })).toThrow();
	});

	it("«Otra» pide el nombre de la fuente, y solo «Otra»", () => {
		expect(
			erroresRegistroInvestigacion(registro({ fuente: "otra" }), AHORA),
		).toContain("Otra");
		expect(
			erroresRegistroInvestigacion(
				registro({ fuente: "otra", fuenteOtra: "Threads" }),
				AHORA,
			),
		).toBeNull();
		expect(
			erroresRegistroInvestigacion(registro({ fuenteOtra: "Threads" }), AHORA),
		).toContain("solo aplica");
	});

	it("la fecha no puede ser futura ni de hace más de 30 días", () => {
		expect(
			erroresRegistroInvestigacion(
				registro({ fechaInvestigacion: new Date(AHORA.getTime() + 3_600_000) }),
				AHORA,
			),
		).toContain("futura");
		expect(
			erroresRegistroInvestigacion(
				registro({
					fechaInvestigacion: new Date(AHORA.getTime() - 31 * 86_400_000),
				}),
				AHORA,
			),
		).toContain("más de 30 días");
	});

	it("el enlace tiene que ser http(s)", () => {
		expect(
			erroresRegistroInvestigacion(
				registro({ enlacePerfil: "facebook.com/juan" }),
				AHORA,
			),
		).toContain("http");
		expect(
			erroresRegistroInvestigacion(
				registro({ enlacePerfil: "https://facebook.com/juan" }),
				AHORA,
			),
		).toBeNull();
	});

	it("no admite archivos repetidos ni más del tope", () => {
		const e = { key: "cobros/investigaciones/x/a.png", nombreArchivo: "a.png" };
		expect(
			erroresRegistroInvestigacion(registro({ evidencias: [e, e] }), AHORA),
		).toContain("repetidos");
		const muchas = Array.from({ length: 11 }, (_, i) => ({
			key: `k${i}`,
			nombreArchivo: `a${i}.png`,
		}));
		expect(() => registro({ evidencias: muchas })).toThrow();
	});
});

describe("etiquetas", () => {
	it("«Otra» muestra el nombre escrito", () => {
		expect(etiquetaFuenteInvestigacion("otra", "Threads")).toBe("Threads");
		expect(etiquetaFuenteInvestigacion("otra", null)).toBe("Otra");
		expect(etiquetaFuenteInvestigacion("instagram")).toBe("Instagram");
		expect(etiquetaFuenteInvestigacion("xyz")).toBe("xyz");
	});
});
