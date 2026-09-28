import { describe, expect, it } from "bun:test";
import { debeMostrarCardInmovilizacion } from "./inmovilizacion-card-gate";

describe("debeMostrarCardInmovilizacion", () => {
	it("B1 sin nada pendiente: NO se muestra", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 1,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(false);
	});

	it("B0 sin nada pendiente: NO se muestra", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 0,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(false);
	});

	it("B5 sin nada pendiente: NO se muestra", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 5,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(false);
	});

	it("bucket null sin nada pendiente: NO se muestra", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: null,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(false);
	});

	it("B2 se muestra (habilita apagado)", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 2,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(true);
	});

	it("B3 se muestra (habilita apagado)", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 3,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(true);
	});

	it("B4 se muestra aunque no habilite apagado (LEGION pendiente CB-120)", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 4,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(true);
	});

	it("B1 con solicitud abierta: se muestra igual (no puede desaparecer con algo en curso)", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 1,
				haySolicitudAbierta: true,
				hayPendienteLlamar: false,
				historialLength: 0,
			}),
		).toBe(true);
	});

	it("B0 con llamada pendiente: se muestra igual (cliente pagó y bajó de bucket)", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 0,
				haySolicitudAbierta: false,
				hayPendienteLlamar: true,
				historialLength: 0,
			}),
		).toBe(true);
	});

	it("B1 con historial (ya tuvo un ciclo cerrado): se muestra igual", () => {
		expect(
			debeMostrarCardInmovilizacion({
				bucketNumero: 1,
				haySolicitudAbierta: false,
				hayPendienteLlamar: false,
				historialLength: 2,
			}),
		).toBe(true);
	});
});
