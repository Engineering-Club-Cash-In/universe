import { describe, expect, it } from "bun:test";
import {
	DIAS_SIN_GESTION_REFERENCIAS,
	debeContactarReferencias,
	inicioVentanaPagoPorConfirmar,
	MIN_INTENTOS_REFERENCIAS,
} from "./agenda-asesor-cobros";
import { seguimientoVacio } from "./seguimiento-cobros";

const AHORA = new Date("2026-10-07T21:00:00Z");
const MS_DIA = 24 * 60 * 60 * 1000;
const conIntentos = (n: number) => ({
	...seguimientoVacio(),
	intentosSinContacto: n,
});

describe("debeContactarReferencias (B7)", () => {
	it("pide referencias desde el tercer intento sin contacto seguido", () => {
		expect(
			debeContactarReferencias(
				conIntentos(MIN_INTENTOS_REFERENCIAS - 1),
				null,
				AHORA,
			),
		).toBe(false);
		expect(
			debeContactarReferencias(
				conIntentos(MIN_INTENTOS_REFERENCIAS),
				null,
				AHORA,
			),
		).toBe(true);
	});

	it("no las pide si ya se gestionaron referencias en los últimos 7 días", () => {
		const hace3Dias = new Date(AHORA.getTime() - 3 * MS_DIA);
		expect(debeContactarReferencias(conIntentos(5), hace3Dias, AHORA)).toBe(
			false,
		);
	});

	it("las vuelve a pedir pasada la ventana", () => {
		const fueraDeVentana = new Date(
			AHORA.getTime() - (DIAS_SIN_GESTION_REFERENCIAS + 1) * MS_DIA,
		);
		expect(
			debeContactarReferencias(conIntentos(5), fueraDeVentana, AHORA),
		).toBe(true);
	});
});

describe("inicioVentanaPagoPorConfirmar (B6, boletas de hoy)", () => {
	it("arranca en la medianoche de Guatemala del día de `ahora`", () => {
		// 2026-10-08 14:42 UTC = 08:42 GT → el día GT es el 8 (medianoche GT = 06:00 UTC).
		expect(
			inicioVentanaPagoPorConfirmar(
				new Date("2026-10-08T14:42:00Z"),
			).toISOString(),
		).toBe("2026-10-08T06:00:00.000Z");
	});

	it("de madrugada UTC todavía es el día anterior en Guatemala", () => {
		// 2026-10-08 03:00 UTC = 21:00 GT del día 7.
		expect(
			inicioVentanaPagoPorConfirmar(
				new Date("2026-10-08T03:00:00Z"),
			).toISOString(),
		).toBe("2026-10-07T06:00:00.000Z");
	});
});
