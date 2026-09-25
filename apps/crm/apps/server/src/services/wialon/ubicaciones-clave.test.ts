/**
 * CB-119 (D-15) — Algoritmo puro de "ubicaciones clave": detección de
 * estancias, clustering y clasificación. Sin I/O, todo con datos sintéticos.
 */
import { describe, expect, test } from "bun:test";
import {
	agruparEstancias,
	calcularUbicacionesClave,
	detectarEstancias,
} from "./ubicaciones-clave";
import type { WialonMensajePosicion } from "./wialon-types";

// Casa: Zona 10 (aprox). Trabajo: Zona 1. Lugar de fin de semana: Amatitlán.
const CASA = { lat: 14.5951, lon: -90.5069 };
const TRABAJO = { lat: 14.6407, lon: -90.5133 };
const SABADOS = { lat: 14.4772, lon: -90.6156 };

const EPOCH_BASE = Date.UTC(2026, 6, 1, 0, 0, 0) / 1000; // 2026-07-01 00:00 UTC

function horaGtAEpoch(diaOffset: number, horaGt: number): number {
	// horaGt en hora de Guatemala (UTC-6) → epoch en segundos UTC.
	return EPOCH_BASE + diaOffset * 86400 + (horaGt + 6) * 3600;
}

function msg(
	epoch: number,
	punto: { lat: number; lon: number },
	velocidadKmh: number | null = 0,
): WialonMensajePosicion {
	return { t: epoch, lat: punto.lat, lon: punto.lon, velocidadKmh };
}

describe("detectarEstancias", () => {
	test("mensajes en el mismo lugar, quietos, por más de 20 min: una estancia", () => {
		const mensajes = [
			msg(1000, CASA),
			msg(1000 + 10 * 60, CASA),
			msg(1000 + 25 * 60, CASA),
		];
		const estancias = detectarEstancias(mensajes);
		expect(estancias).toHaveLength(1);
		expect(estancias[0]?.lat).toBeCloseTo(CASA.lat, 3);
	});

	test("tramo corto (menos de 20 min): no cuenta como estancia", () => {
		const mensajes = [msg(1000, CASA), msg(1000 + 5 * 60, CASA)];
		expect(detectarEstancias(mensajes)).toHaveLength(0);
	});

	test("vehículo en movimiento (velocidad alta): no genera estancia", () => {
		const mensajes = [msg(1000, CASA, 60), msg(1000 + 30 * 60, CASA, 55)];
		expect(detectarEstancias(mensajes)).toHaveLength(0);
	});

	test("dos lugares distintos separados por viaje: dos estancias", () => {
		const mensajes = [
			msg(1000, CASA),
			msg(1000 + 30 * 60, CASA),
			msg(1000 + 40 * 60, TRABAJO, 80), // viaje
			msg(1000 + 60 * 60, TRABAJO),
			msg(1000 + 90 * 60, TRABAJO),
		];
		const estancias = detectarEstancias(mensajes);
		expect(estancias).toHaveLength(2);
	});

	test("hueco de horas sin mensajes en el mismo lugar: sigue siendo una sola estancia larga (el caso de la noche)", () => {
		const mensajes = [
			msg(1000, CASA),
			// 8 horas sin ningún mensaje — el vehículo estacionado de noche
			// simplemente no reporta.
			msg(1000 + 8 * 60 * 60, CASA),
		];
		const estancias = detectarEstancias(mensajes);
		expect(estancias).toHaveLength(1);
		const horas =
			(estancias[0]!.hasta.getTime() - estancias[0]!.desde.getTime()) /
			(60 * 60 * 1000);
		expect(horas).toBeCloseTo(8, 1);
	});
});

describe("agruparEstancias", () => {
	test("estancias en el mismo punto exacto se agrupan en un cluster", () => {
		const estancias = detectarEstancias([
			msg(1000, CASA),
			msg(1000 + 30 * 60, CASA),
			msg(1000 + 40 * 60, TRABAJO, 80),
			msg(1000 + 41 * 60 + 30 * 60, CASA),
			msg(1000 + 41 * 60 + 60 * 60, CASA),
		]);
		const clusters = agruparEstancias(estancias);
		// CASA aparece dos veces → un solo cluster con 2 visitas.
		const clusterCasa = clusters.find(
			(c) => Math.abs(c.lat - CASA.lat) < 0.001,
		);
		expect(clusterCasa?.visitas).toBe(2);
	});
});

describe("calcularUbicacionesClave — 60 días sintéticos", () => {
	function generarHistorialSesentaDias(): WialonMensajePosicion[] {
		const mensajes: WialonMensajePosicion[] = [];

		for (let dia = 0; dia < 60; dia++) {
			const fecha = new Date(EPOCH_BASE * 1000 + dia * 86400 * 1000);
			const diaSemanaUtc = fecha.getUTCDay();

			// Casa: todas las noches, 22:00-06:00 GT.
			mensajes.push(msg(horaGtAEpoch(dia, 22), CASA));
			mensajes.push(msg(horaGtAEpoch(dia, 23), CASA));
			mensajes.push(msg(horaGtAEpoch(dia + 1, 5), CASA));

			// Trabajo: L-V, 8:00-17:00 GT (diaSemanaUtc: 1=lunes .. 5=viernes).
			if (diaSemanaUtc >= 1 && diaSemanaUtc <= 5) {
				mensajes.push(msg(horaGtAEpoch(dia, 9), TRABAJO));
				mensajes.push(msg(horaGtAEpoch(dia, 12), TRABAJO));
				mensajes.push(msg(horaGtAEpoch(dia, 16), TRABAJO));
			}

			// Lugar recurrente: solo sábados, 3 horas.
			if (diaSemanaUtc === 6) {
				mensajes.push(msg(horaGtAEpoch(dia, 15), SABADOS));
				mensajes.push(msg(horaGtAEpoch(dia, 17), SABADOS));
			}

			// Ruido: una entrega ocasional que no debería aparecer como
			// ubicación clave (solo una vez, en un punto que nunca se repite).
			if (dia === 30) {
				mensajes.push(msg(horaGtAEpoch(dia, 13), { lat: 14.55, lon: -90.44 }));
				mensajes.push(
					msg(horaGtAEpoch(dia, 13) + 25 * 60, { lat: 14.55, lon: -90.44 }),
				);
			}
		}

		return mensajes;
	}

	const ubicaciones = calcularUbicacionesClave(generarHistorialSesentaDias());

	test("detecta la casa como probable_casa", () => {
		const casa = ubicaciones.find((u) => u.tipo === "probable_casa");
		expect(casa).toBeDefined();
		expect(casa?.lat).toBeCloseTo(CASA.lat, 3);
		expect(casa?.diasDistintos).toBeGreaterThanOrEqual(50);
	});

	test("detecta el trabajo como probable_trabajo", () => {
		const trabajo = ubicaciones.find((u) => u.tipo === "probable_trabajo");
		expect(trabajo).toBeDefined();
		expect(trabajo?.lat).toBeCloseTo(TRABAJO.lat, 3);
	});

	test("detecta el lugar de los sábados como recurrente", () => {
		const sabados = ubicaciones.find((u) => u.tipo === "recurrente");
		expect(sabados).toBeDefined();
		expect(sabados?.lat).toBeCloseTo(SABADOS.lat, 3);
	});

	test("la entrega aislada (ruido) no aparece como ubicación clave", () => {
		const ruido = ubicaciones.find(
			(u) => Math.abs(u.lat - 14.55) < 0.01 && Math.abs(u.lon - -90.44) < 0.01,
		);
		expect(ruido).toBeUndefined();
	});

	test("devuelve como máximo 5 ubicaciones, ordenadas por horas totales descendente", () => {
		expect(ubicaciones.length).toBeLessThanOrEqual(5);
		for (let i = 1; i < ubicaciones.length; i++) {
			expect(ubicaciones[i - 1]!.horasTotales).toBeGreaterThanOrEqual(
				ubicaciones[i]!.horasTotales,
			);
		}
	});
});

describe("calcularUbicacionesClave — sin historial", () => {
	test("arreglo vacío: no genera ubicaciones", () => {
		expect(calcularUbicacionesClave([])).toEqual([]);
	});
});
