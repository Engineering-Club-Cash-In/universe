import { describe, expect, test } from "bun:test";
import {
	diasSinGestion,
	estadoGestionConConvenio,
	nivelContactabilidad,
} from "./ficha-cobros";

describe("nivelContactabilidad", () => {
	test("sin intentos no hay nivel", () => {
		expect(nivelContactabilidad(0, 0)).toBeNull();
	});
	test("alta desde 50 %", () => {
		expect(nivelContactabilidad(1, 2)).toBe("alta");
		expect(nivelContactabilidad(5, 5)).toBe("alta");
	});
	test("media entre 20 % y 50 %", () => {
		expect(nivelContactabilidad(1, 5)).toBe("media");
		expect(nivelContactabilidad(4, 9)).toBe("media");
	});
	test("baja bajo 20 %", () => {
		expect(nivelContactabilidad(0, 4)).toBe("baja");
		expect(nivelContactabilidad(1, 6)).toBe("baja");
	});
});

describe("diasSinGestion", () => {
	// 2026-10-06 15:00 GT = 21:00 UTC
	const ahora = new Date("2026-10-06T21:00:00Z");
	test("sin gestiones → null", () => {
		expect(diasSinGestion(null, ahora)).toBeNull();
	});
	test("gestión de hoy → 0", () => {
		expect(diasSinGestion(new Date("2026-10-06T14:00:00Z"), ahora)).toBe(0);
	});
	test("cuenta días de Guatemala, no de UTC", () => {
		// 2026-10-04 23:30 GT = 2026-10-05 05:30 UTC → hace 2 días en GT.
		expect(diasSinGestion(new Date("2026-10-05T05:30:00Z"), ahora)).toBe(2);
	});
});

describe("estadoGestionConConvenio", () => {
	test("EN_CONVENIO sin aprobar → convenio pendiente", () => {
		expect(estadoGestionConConvenio("convenio_vigente", false)).toBe(
			"convenio_pendiente",
		);
	});
	test("convenio aprobado (activo) → sigue vigente", () => {
		expect(estadoGestionConConvenio("convenio_vigente", true)).toBe(
			"convenio_vigente",
		);
	});
	test("cartera no respondió → se deja como venía", () => {
		expect(estadoGestionConConvenio("convenio_vigente", null)).toBe(
			"convenio_vigente",
		);
	});
	test("sin convenio no toca el estado", () => {
		expect(estadoGestionConConvenio("promesa_vigente", false)).toBe(
			"promesa_vigente",
		);
		expect(estadoGestionConConvenio("sin_acuerdo", false)).toBe("sin_acuerdo");
	});
});
