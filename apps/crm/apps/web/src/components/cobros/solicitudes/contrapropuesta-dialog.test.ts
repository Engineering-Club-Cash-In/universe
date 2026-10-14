import { describe, expect, test } from "bun:test";
import { ventanaPrimerPago } from "./contrapropuesta-dialog";

describe("ventanaPrimerPago", () => {
	test("convenio firmado hoy: el primer pago es desde mañana", () => {
		expect(ventanaPrimerPago("2026-10-13", "2026-10-13").min).toBe(
			"2026-10-14",
		);
	});

	test("convenio de días atrás: manda hoy", () => {
		expect(ventanaPrimerPago("2026-10-13", "2026-10-10").min).toBe(
			"2026-10-13",
		);
	});

	test("sin fecha del convenio: desde hoy", () => {
		expect(ventanaPrimerPago("2026-10-13", null).min).toBe("2026-10-13");
	});

	test("el tope son 90 días desde hoy", () => {
		expect(ventanaPrimerPago("2026-10-13", null).max).toBe("2027-01-11");
	});
});
