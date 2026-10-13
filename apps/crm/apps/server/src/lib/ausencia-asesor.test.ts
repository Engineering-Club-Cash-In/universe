import { describe, expect, test } from "bun:test";
import {
	motivoDeLaDevolucion,
	motivoDelReparto,
	textoAvisoReactivacion,
} from "./ausencia-asesor";

describe("ausencia-asesor", () => {
	test("el motivo del reparto nombra la causa", () => {
		expect(motivoDelReparto("incidente")).toContain("Incidente");
		expect(motivoDelReparto("permiso")).toContain("Permiso");
	});

	test("el motivo de la devolución nombra al asesor", () => {
		expect(motivoDeLaDevolucion("Ana")).toContain("Ana");
		expect(motivoDeLaDevolucion(null)).toContain("asesor");
	});

	test("el aviso cuenta lo devuelto y lo que se quedó", () => {
		const a = textoAvisoReactivacion({
			nombre: "Ana",
			devueltas: 28,
			retenidas: 3,
		});
		expect(a.titulo).toBe("Ana se reactivó");
		expect(a.descripcion).toContain("28 cuentas");
		expect(a.descripcion).toContain("3 cuentas se quedaron");
	});

	test("singular y sin nada por devolver", () => {
		expect(
			textoAvisoReactivacion({ nombre: "Ana", devueltas: 1, retenidas: 1 })
				.descripcion,
		).toContain("1 cuenta se quedó");
		const vacio = textoAvisoReactivacion({
			nombre: null,
			devueltas: 0,
			retenidas: 0,
		});
		expect(vacio.titulo).toBe("Un asesor se reactivó");
		expect(vacio.descripcion).toContain("No había cuentas por devolver");
	});
});
